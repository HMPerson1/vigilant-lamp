#![allow(dead_code)]
use std::env::args_os;
use std::fs;
use std::io;

use serde::Deserialize;
use serde_json::Value;

fn main() -> io::Result<()> {
    let raw: Value = serde_json::from_slice(&fs::read(args_os().nth(1).unwrap())?)?;
    parse(raw);
    Ok(())
}

fn parse(raw: Value) -> Option<()> {
    let events = &**raw.as_object()?.get("traceEvents")?.as_array()?;
    let events: Box<[Event]> = events
        .iter()
        .map(|ev| serde_json::from_value(ev.clone()).unwrap())
        .collect();
    let first_mousedown_ts = events.iter().find(|e| is_eventdispatch_type(e, "mousedown")).unwrap().ts;
    let first_mouseup_ts = events.iter().find(|e| is_eventdispatch_type(e, "mouseup")).unwrap().ts;
    let mousemove_events: Box<_> = events
        .iter()
        .filter(|e| first_mousedown_ts < e.ts && e.ts < first_mouseup_ts)
        .filter(|e| is_eventdispatch_type(e, "mousemove"))
        .collect();
    let event_dispatch_tid = mousemove_events.first()?.tid;
    assert!(mousemove_events
        .iter()
        .all(|ev| ev.tid == event_dispatch_tid));
    let tasks: Box<_> = events
        .iter()
        .filter(|ev| ev.tid == event_dispatch_tid && ev.name == "RunTask")
        .collect();
    let event_task_durs = mousemove_events.iter().map(|event| {
        tasks
            .iter()
            .find(|task| encloses(event, task))
            .unwrap()
            .dur
            .unwrap()
    });
    for v in event_task_durs {
        println!("{}", v);
    }
    Some(())
}

fn encloses(inner: &Event, outer: &Event) -> bool {
    outer.ts <= inner.ts && (inner.ts + inner.dur.unwrap()) <= (outer.ts + outer.dur.unwrap())
}

fn is_eventdispatch_type(ev: &Event, ty: &str) -> bool {
    ev.name == "EventDispatch"
        && serde_json::from_value::<EventEventDispatchArgs>(ev.args.clone())
            .unwrap()
            .data
            .type_
            == ty
}

fn event_to_profile_entry(ev: &Value) -> Option<CpuProfileEntry> {
    serde_json::from_value(
        ev.as_object()?
            .get("args")?
            .as_object()?
            .get("data")?
            .as_object()?
            .get("cpuProfile")?
            .clone(),
    )
    .unwrap()
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Event {
    name: String,
    cat: String,
    ph: String,
    ts: u64,
    pid: u32,
    tid: u32,
    args: Value,
    dur: Option<u64>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct EventEventDispatchArgs {
    data: EventEventDispatchArgsData,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct EventEventDispatchArgsData {
    type_: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct CpuProfileEntry {
    nodes: Option<Vec<ProfileNode>>,
    start_time: Option<u64>,
    samples: Vec<u64>,
    time_deltas: Option<Vec<u64>>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ProfileNode {
    id: u64,
    call_frame: CallFrame,
    hit_count: u64,
    children: Vec<u64>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct CallFrame {
    function_name: String,
    script_id: Value,
    url: Option<String>,
    line_number: Option<u32>,
    column_number: Option<u32>,
}
