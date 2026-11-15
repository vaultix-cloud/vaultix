//! `vx-mcp`: the tool server an AI client (Claude Code) connects to over stdio.
//!
//! What it lets the model do: see which secrets exist (names and versions), ask a person to supply
//! one, and run a command a person has approved, with the secrets that command needs injected into
//! its environment. What it never does: return a value, accept a value, or run a command the model
//! chose. The model picks a profile by name; the command line, the secrets and the working directory
//! come from a profile file a person wrote (`VX_MCP_PROFILES`). By default a run returns only the exit
//! code and a message the person wrote for it: the command's output never reaches the model. A profile
//! can opt in to returning output, which then passes the output gate. Everything returned passes it.
//!
//! Limits, stated plainly: for a profile that opts in to returning output, the gate catches a value
//! printed as it is, or in hex or base64. A program that transforms a value before printing it
//! (reversing it, splitting it) is a leak the gate cannot see; a real Claude session reversed such
//! output back into the value in testing. That is why returning output is off by default, why
//! profiles are written and reviewed by people, and why the model cannot add arguments to them.
//! The exit code is still a narrow channel a hostile approved program could use.

#![allow(clippy::print_stdout, clippy::print_stderr)] // the protocol is JSON lines on stdout

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{BufRead, Read, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use vx_client::{Client, SecretRef};
use vx_gate::Gate;

const MAX_OUTPUT: usize = 64 * 1024;

#[derive(serde::Deserialize)]
struct ProfileFile {
    profiles: BTreeMap<String, Profile>,
}

#[derive(serde::Deserialize)]
struct Profile {
    description: String,
    argv: Vec<String>,
    secrets: Vec<ProfileSecret>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default = "thirty")]
    timeout_seconds: u64,
    /// What the model gets back. `status` (the default) is the exit code and the message a person wrote
    /// for it: the command's own output never reaches the model. `gated` also returns the output, after
    /// the output gate, which cannot see a value that the command has transformed.
    #[serde(default)]
    output: Output,
    /// Messages a person wrote for exit codes, for example {"0": "The token works", "1": "The token was rejected"}.
    #[serde(default)]
    results: BTreeMap<String, String>,
}

#[derive(serde::Deserialize, Default, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Output {
    #[default]
    Status,
    Gated,
}

fn thirty() -> u64 {
    30
}

#[derive(serde::Deserialize)]
struct ProfileSecret {
    env: String,
    #[serde(flatten)]
    reference: SecretRef,
}

struct Server {
    client: Result<Client, String>,
    profiles: Result<BTreeMap<String, Profile>, String>,
}

fn main() {
    let profiles = match std::env::var("VX_MCP_PROFILES") {
        Ok(path) => std::fs::read_to_string(&path)
            .map_err(|_| "the profiles file cannot be read".to_string())
            .and_then(|text| serde_json::from_str::<ProfileFile>(&text).map_err(|e| format!("the profiles file is not valid: {e}")))
            .map(|file| file.profiles),
        Err(_) => Err("VX_MCP_PROFILES is not set, so no commands are approved".into()),
    };
    let server = Server { client: Client::from_env("mcp:claude-code"), profiles };
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(reply) = server.handle(&message) {
            let _ = writeln!(out, "{reply}");
            let _ = out.flush();
        }
    }
}

fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({ "name": name, "description": description, "inputSchema": { "type": "object", "properties": properties, "required": required, "additionalProperties": false } })
}

impl Server {
    fn handle(&self, message: &Value) -> Option<Value> {
        let id = message.get("id")?.clone();
        let method = message["method"].as_str().unwrap_or("");
        let result = match method {
            "initialize" => json!({
                "protocolVersion": message["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "vaultix", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "Vaultix holds secrets. You can see names and versions, ask the person to supply a value, and run an approved profile that uses secrets. You can never read a value; do not ask for one."
            }),
            "ping" => json!({}),
            "tools/list" => json!({ "tools": [
                tool("vaultix_profiles", "List the approved commands (profiles) you can run, with what each does.", json!({}), &[]),
                tool("vaultix_secrets_list", "List the secrets in a project environment: names and versions only, never values.",
                    json!({ "project": { "type": "string" }, "environment": { "type": "string" } }), &["project", "environment"]),
                tool("vaultix_request_value", "Ask the person to supply a missing secret. You get back the command they run themselves; you never receive the value.",
                    json!({ "project": { "type": "string" }, "environment": { "type": "string" }, "name": { "type": "string" }, "purpose": { "type": "string" } }), &["project", "environment", "name", "purpose"]),
                tool("vaultix_run", "Run an approved profile. The secrets it needs are injected into the command, which you cannot see or change. Returns the exit code and the result message a person wrote for it. A profile may also return the command's output, with any secret value withheld.",
                    json!({ "profile": { "type": "string" } }), &["profile"]),
            ] }),
            "tools/call" => self.call(&message["params"]),
            _ => return Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "method not found" } })),
        };
        Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
    }

    fn call(&self, params: &Value) -> Value {
        let arguments = &params["arguments"];
        let text = |key: &str| arguments[key].as_str().unwrap_or("").to_string();
        let outcome = match params["name"].as_str().unwrap_or("") {
            "vaultix_profiles" => self.profiles_list(),
            "vaultix_secrets_list" => self.client().and_then(|c| c.list(&text("project"), &text("environment")).map(|v| v.to_string()).map_err(|e| e.to_string())),
            "vaultix_request_value" => self.request_value(&text("project"), &text("environment"), &text("name"), &text("purpose")),
            "vaultix_run" => self.run(&text("profile")),
            other => Err(format!("unknown tool {other}")),
        };
        match outcome {
            Ok(body) => reply(&body, false),
            Err(message) => reply(&message, true),
        }
    }

    fn client(&self) -> Result<&Client, String> {
        self.client.as_ref().map_err(Clone::clone)
    }

    fn profiles_list(&self) -> Result<String, String> {
        let profiles = self.profiles.as_ref().map_err(Clone::clone)?;
        let listed: Vec<Value> = profiles.iter().map(|(name, p)| json!({ "profile": name, "description": p.description, "secrets": p.secrets.iter().map(|s| &s.reference.name).collect::<Vec<_>>() })).collect();
        Ok(json!({ "profiles": listed }).to_string())
    }

    fn request_value(&self, project: &str, environment: &str, name: &str, purpose: &str) -> Result<String, String> {
        let reference = SecretRef { project: project.into(), environment: environment.into(), path: None, name: name.into() };
        self.client()?.request_value(&reference, purpose).map_err(|e| e.to_string())?;
        Ok(format!("Recorded. Ask the person to run this in their own terminal (the value is typed there, not here): vx set --project {project} --env {environment} {name}"))
    }

    fn run(&self, profile_name: &str) -> Result<String, String> {
        let profiles = self.profiles.as_ref().map_err(Clone::clone)?;
        let profile = profiles.get(profile_name).ok_or_else(|| format!("there is no approved profile named \"{profile_name}\"; call vaultix_profiles"))?;
        let references: Vec<SecretRef> = profile.secrets.iter().map(|s| s.reference.clone()).collect();
        let values = self.client()?.redeem(&references, &format!("profile {profile_name}")).map_err(|e| e.to_string())?;
        let mut gate = Gate::new();
        let mut environment: Vec<(String, String)> = Vec::new();
        for (name, value) in &values {
            gate.learn(value);
            let var = profile.secrets.iter().find(|s| &s.reference.name == name).map(|s| s.env.clone()).ok_or("the server returned a secret that was not asked for")?;
            environment.push((var, inject_text(value)));
        }
        let (code, stdout, stderr) = execute(profile, &environment)?;
        drop(values);
        let shown = |label: &str, text: String| match gate.check(&text) {
            Ok(()) => text,
            Err(blocked) => format!("[{label} withheld: it contained a value held by Vaultix ({blocked})]"),
        };
        if profile.output == Output::Status {
            let message = profile.results.get(&code.to_string()).cloned().unwrap_or_else(|| format!("The command exited with code {code}."));
            return Ok(json!({ "exitCode": code, "result": message, "output": "not returned: this profile returns only the exit code and its message" }).to_string());
        }
        Ok(json!({ "exitCode": code, "stdout": shown("stdout", stdout), "stderr": shown("stderr", stderr) }).to_string())
    }
}

#[allow(clippy::disallowed_methods)] // value path: a secret is placed into the child's environment and nowhere else
fn inject_text(value: &vx_secret::Secret) -> String {
    String::from_utf8_lossy(value.expose()).into_owned()
}

/// What a tool returns passes the output gate, whatever it is.
fn reply(text: &str, is_error: bool) -> Value {
    let gate = Gate::new();
    let body = match gate.check(text) {
        Ok(()) => text.to_string(),
        Err(blocked) => format!("[output withheld by the Vaultix output gate ({blocked})]"),
    };
    json!({ "content": [{ "type": "text", "text": body }], "isError": is_error })
}

fn execute(profile: &Profile, injected: &[(String, String)]) -> Result<(i32, String, String), String> {
    let (program, args) = profile.argv.split_first().ok_or("the profile has no command")?;
    let mut command = Command::new(program);
    command.args(args).env_clear().stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // The child gets a minimal environment: no Vaultix token, none of the model's, only what it needs to run.
    for keep in ["PATH", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG"] {
        if let Ok(value) = std::env::var(keep) {
            command.env(keep, value);
        }
    }
    for (name, value) in injected {
        command.env(name, value);
    }
    if let Some(cwd) = &profile.cwd {
        command.current_dir(cwd);
    }
    let mut child = command.spawn().map_err(|e| format!("the command could not start: {}", e.kind()))?;
    let mut stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    let out = std::thread::spawn(move || read_capped(&mut stdout));
    let err = std::thread::spawn(move || read_capped(&mut stderr));
    let deadline = Instant::now() + Duration::from_secs(profile.timeout_seconds.clamp(1, 300));
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("the command ran longer than {} seconds and was stopped", profile.timeout_seconds));
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    };
    Ok((status.code().unwrap_or(-1), out.join().unwrap_or_default(), err.join().unwrap_or_default()))
}

fn read_capped(reader: &mut impl Read) -> String {
    let mut buffer = Vec::new();
    let _ = reader.take(MAX_OUTPUT as u64).read_to_end(&mut buffer);
    String::from_utf8_lossy(&buffer).into_owned()
}
