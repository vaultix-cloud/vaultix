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
    let user = std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_else(|_| "person".into()).to_lowercase().replace(' ', "-");
    let client = match Client::from_env(&format!("human:{user}")) {
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

fn fail(message: &str) {
    eprintln!("vx: {message}");
    std::process::exit(1);
}
