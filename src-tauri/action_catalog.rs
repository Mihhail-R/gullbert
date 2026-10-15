//! Build-time validation and Rust generation for the shared public action catalog.
use serde_json::Value;
use std::collections::HashSet;

pub fn generate(source: &str) -> Result<String, String> {
    let catalog: Value = serde_json::from_str(source).map_err(|e| e.to_string())?;
    let entries = catalog.as_object().ok_or("actions must be an object")?;
    if entries.is_empty() {
        return Err("actions must not be empty".into());
    }
    let mut aliases = HashSet::new();
    let mut variants = HashSet::new();
    let mut declarations = String::new();
    let mut names = String::new();
    let mut launchers = String::new();
    let mut routes = String::new();
    for (name, value) in entries {
        let error = || format!("Invalid action definition: {name}");
        let entry = value.as_object().ok_or_else(error)?;
        let string = |key: &str| entry.get(key).and_then(Value::as_str).ok_or_else(error);
        let identifier =
            |s: &str| !s.is_empty() && s.bytes().all(|c| c.is_ascii_lowercase() || c == b'_');
        if !identifier(name) {
            return Err(error());
        }
        let variant = string("variant")?;
        if !variant
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_uppercase)
            || !variant.bytes().all(|c| c.is_ascii_alphabetic())
            || !variants.insert(variant)
        {
            return Err(error());
        }
        let cfg = match string("availability")? {
            "all" => "",
            "debug_macos" => "#[cfg(all(debug_assertions, target_os = \"macos\"))]\n",
            _ => return Err(error()),
        };
        let visibility = match string("visibility")? {
            "show" => "Visibility::Show",
            "hide" => "Visibility::Hide",
            "preserve" => "Visibility::Preserve",
            _ => return Err(error()),
        };
        let route = string("route")?;
        let mut fields = vec!["variant", "aliases", "availability", "visibility", "route"];
        let routing = match route {
            "command" | "pointer" => {
                fields.push("command");
                let command = string("command")?;
                if !identifier(command) {
                    return Err(error());
                }
                let kind = if route == "command" {
                    "Command"
                } else {
                    "Pointer"
                };
                format!("Route::{kind}({command:?})")
            }
            "target" => {
                fields.extend(["purpose", "preparation"]);
                let purpose = string("purpose")?;
                let preparation = string("preparation")?;
                if !identifier(purpose)
                    || !matches!(preparation, "cancel" | "prepare_chip" | "tidy")
                    || (purpose == "tidy") != (preparation == "tidy")
                    || (purpose == "feed_here") != (preparation == "prepare_chip")
                {
                    return Err(error());
                }
                let purpose = if purpose == "tidy" {
                    "TargetPurpose::Tidy".into()
                } else {
                    format!("TargetPurpose::Placement({purpose:?})")
                };
                format!("Route::Target({purpose}, {preparation:?})")
            }
            "hide" => "Route::Visibility".into(),
            "show" => "Route::Visibility".into(),
            "controls" => "Route::Controls".into(),
            "quit" => "Route::Quit".into(),
            "cursor" => "Route::Cursor".into(),
            "window_probe" => "Route::WindowProbe".into(),
            "window_spike" => "Route::WindowSpike".into(),
            _ => return Err(error()),
        };
        let preparation = if route != "target" && entry.contains_key("preparation") {
            fields.push("preparation");
            if !matches!(route, "show" | "controls" | "window_probe" | "window_spike")
                || string("preparation")? != "tidy_cancel"
            {
                return Err(error());
            }
            format!("Some({:?})", string("preparation")?)
        } else {
            "None".into()
        };
        let expected_visibility = match route {
            "hide" => "hide",
            "controls" | "quit" | "window_probe" | "window_spike" => "preserve",
            "command" => string("visibility")?,
            _ => "show",
        };
        if string("visibility")? != expected_visibility
            || (route.starts_with("window_") != !cfg.is_empty())
            || entry.keys().any(|key| !fields.contains(&key.as_str()))
        {
            return Err(error());
        }
        let flags = entry
            .get("aliases")
            .and_then(Value::as_array)
            .ok_or_else(error)?;
        for flag in flags {
            let flag = flag.as_str().ok_or_else(error)?;
            if !flag.starts_with("--")
                || flag.len() < 3
                || !flag[2..]
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c == b'-')
                || !aliases.insert(flag)
            {
                return Err(format!("Invalid or duplicate launcher alias: {flag}"));
            }
            launchers.push_str(&format!("{cfg}Some({flag:?}) => Action::{variant},\n"));
        }
        declarations.push_str(&format!("{cfg}#[serde(rename = {name:?})]\n{variant},\n"));
        names.push_str(&format!("{cfg}{name:?} => Some(Self::{variant}),\n"));
        routes.push_str(&format!(
            "{cfg}Self::{variant} => ({visibility}, {routing}, {preparation}),\n"
        ));
    }
    Ok(format!(
        r#"
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
pub(crate) enum Action {{ {declarations} }}
impl Action {{
    pub(crate) fn named(name: &str) -> Option<Self> {{ match name {{ {names} _ => None }} }}
    fn routing(self) -> (Visibility, Route, Option<&'static str>) {{ match self {{ {routes} }} }}
}}
pub(crate) fn from_cli(flag: Option<&str>) -> Action {{ match flag {{ {launchers} _ => Action::Controls }} }}
"#
    ))
}
