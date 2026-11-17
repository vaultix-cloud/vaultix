//! `vx`: the human's command. A person enters a secret value here, at their own terminal, so the
//! value never passes through an AI client or its chat.
//!
//!   vx set --project P --env E [--path /x/] NAME      prompts for the value without echoing it
//!   echo -n "$VALUE" | vx set --project P --env E NAME --stdin
//!   vx list --project P --env E                       names and versions, never values

#![allow(clippy::print_stdout, clippy::print_stderr)] // this is a command-line program

use std::io::Read;
use vx_client::{Client, SecretRef};
use vx_secret::Secret;

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn positional(args: &[String]) -> Option<String> {
    let mut skip = false;
    for arg in args {
        if skip {
            skip = false;
        } else if ["--project", "--env", "--path"].contains(&arg.as_str()) {
            skip = true;
        } else if !arg.starts_with("--") {
            return Some(arg.clone());
        }
    }
    None
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str)==Some("session") { return session(&args); }
    let client = match Client::from_env() {
        Ok(client) => client,
        Err(error) => return fail(&error),
    };
    let (Some(project), Some(environment)) = (flag(&args, "--project"), flag(&args, "--env")) else {
        return fail("--project and --env are required");
    };
    match args.first().map(String::as_str) {
        Some("set") => {
            let Some(name) = positional(&args[1..]) else { return fail("name the secret: vx set --project P --env E NAME") };
            let reference = SecretRef { project, environment, path: flag(&args, "--path"), name: name.clone() };
            let value = if args.iter().any(|a| a == "--stdin") {
                let mut text = String::new();
                if std::io::stdin().read_to_string(&mut text).is_err() {
                    return fail("the value could not be read from standard input");
                }
                Secret::from_string(text.trim_end_matches(['\r', '\n']).to_string())
            } else {
                match rpassword::prompt_password(format!("Value for {name} (hidden): ")) {
                    Ok(text) => Secret::from_string(text),
                    Err(_) => return fail("the value could not be read from the terminal; use --stdin"),
                }
            };
            if value.is_empty() {
                return fail("an empty value was not stored");
            }
            match client.put(&reference, &value) {
                Ok(answer) => println!("Stored {name}, version {}.", answer["version"]),
                Err(error) => fail(&error.to_string()),
            }
        }
        Some("list") => match client.list(&project, &environment) {
            Ok(answer) => println!("{}", serde_json::to_string_pretty(&answer).unwrap_or_default()),
            Err(error) => fail(&error.to_string()),
        },
        _ => fail("usage: vx set|list --project P --env E [NAME]"),
    }
}

/// A human session stays in this process; no password or bearer is written to config or stdout.
/// --stdin-auth reads one JSON line followed by commands, for automation at the human boundary.
fn session(args:&[String]) {
    use std::io::BufRead;
    use zeroize::Zeroizing;
    #[derive(serde::Deserialize)]
    #[serde(rename_all="camelCase",deny_unknown_fields)]
    struct Credentials { email:String,password:String,#[serde(default)] setup_code:Option<String> }
    let (Some(project),Some(environment))=(flag(args,"--project"),flag(args,"--env")) else {return fail("--project and --env are required")};
    let stdin=std::io::stdin();
    let mut input=stdin.lock();
    let scripted=args.iter().any(|a|a=="--stdin-auth");
    let (email,password,code)=if scripted {
        let mut line=Zeroizing::new(String::new());
        if input.by_ref().take(16*1024).read_line(&mut line).is_err(){return fail("credentials could not be read")}
        let c:Credentials=match serde_json::from_str(&line){Ok(c)=>c,Err(_)=>return fail("credentials must be one JSON line with email, password and optional setupCode")};
        (c.email,Secret::from_string(c.password),c.setup_code)
    } else {
        let Some(email)=flag(args,"--email") else {return fail("--email is required")};
        let code=if args.iter().any(|a|a=="--setup") {Some(rpassword::prompt_password("One-time setup code: ").unwrap_or_else(|_|{fail("setup code could not be read");String::new()}))}else{None};
        let password=match rpassword::prompt_password("Password (hidden): "){Ok(p)=>Secret::from_string(p),Err(_)=>return fail("password could not be read")};
        (email,password,code)
    };
    let anonymous=match Client::anonymous(){Ok(c)=>c,Err(e)=>return fail(&e)};
    if let Some(code)=code {
        let code=Zeroizing::new(code);
        let Some(organization)=flag(args,"--organization") else {return fail("--organization is required for first-owner setup")};
        if let Err(e)=anonymous.setup(&code,&email,&password,&organization,&project,&environment){return fail(&e.to_string())}
        println!("Owner created.");
    }
    let client=match anonymous.login(&email,&password){Ok(c)=>c,Err(e)=>return fail(&e.to_string())};
    drop(password);
    println!("Signed in. Commands: list, logout. This session expires after 15 minutes.");
    loop {
        let mut command=String::new();
        if input.read_line(&mut command).unwrap_or(0)==0 || command.trim()=="logout" {break}
        match command.trim() {
            "list"=>match client.list(&project,&environment){Ok(value)=>println!("{}",serde_json::to_string_pretty(&value).unwrap_or_default()),Err(e)=>eprintln!("{}",e)},
            _=>println!("Commands: list, logout"),
        }
    }
    if let Err(e)=client.logout(){return fail(&format!("Sign-out could not be confirmed: {e}"))}
    println!("Signed out.");
    match client.list(&project,&environment) {
        Err(e) if e.status==401=>println!("Access denied: the signed-out session is no longer valid."),
        _=>fail("session revocation could not be verified"),
    }
}

fn fail(message: &str) {
    eprintln!("vx: {message}");
    std::process::exit(1);
}
