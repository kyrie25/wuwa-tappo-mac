use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker};
use objc2_app_kit::{NSEvent, NSEventMask};
use serde::Serialize;
use std::{
    cell::RefCell,
    collections::BTreeMap,
    ffi::c_void,
    ptr::NonNull,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct InputStatus {
    pub running: bool,
    #[serde(rename = "permissionRequired")]
    pub permission_required: bool,
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct MousePosition {
    pub x: f64,
    pub y: f64,
    #[serde(rename = "memberId", skip_serializing_if = "Option::is_none")]
    pub member_id: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct MouseButton {
    button: &'static str,
    action: &'static str,
    #[serde(rename = "memberId", skip_serializing_if = "Option::is_none")]
    member_id: Option<u64>,
}

type MemberResolver = Arc<dyn Fn(f64, f64) -> Option<u64> + Send + Sync>;
type AuxiliaryHitTest = Arc<dyn Fn(f64, f64) -> bool + Send + Sync>;

struct MonitorState {
    running: AtomicBool,
    stop: AtomicBool,
    scale: AtomicU64,
    window_listener_installed: AtomicBool,
    error: Mutex<Option<String>>,
    member_resolver: Mutex<Option<MemberResolver>>,
    auxiliary_hit_test: Mutex<Option<AuxiliaryHitTest>>,
}

impl MonitorState {
    fn error(&self, message: String) {
        if let Ok(mut error) = self.error.lock() {
            *error = Some(message);
        }
    }

    fn status(&self) -> InputStatus {
        let running = self.running.load(Ordering::Acquire);
        InputStatus {
            running,
            permission_required: false,
            error: if running {
                None
            } else {
                self.error
                    .lock()
                    .ok()
                    .and_then(|error| error.clone())
                    .or_else(|| Some("input_counter_not_running".into()))
            },
        }
    }
}

thread_local! {
    static MOUSE_MONITOR: RefCell<Option<MouseMonitor>> = const { RefCell::new(None) };
}

// AppKit owns the copied blocks; monitor tokens are removed on the main thread.
struct MouseMonitor {
    global: Retained<AnyObject>,
    local: Option<Retained<AnyObject>>,
}

impl Drop for MouseMonitor {
    fn drop(&mut self) {
        unsafe {
            NSEvent::removeMonitor(&self.global);
            if let Some(local) = &self.local {
                NSEvent::removeMonitor(local);
            }
        }
    }
}

fn mouse_input(kind: u32, button: i64, point: Point) -> Option<NativeInput> {
    match kind {
        1 | 2 | 3 | 4 | 25 | 26 => {
            let button = match kind {
                1 | 2 => "left",
                3 | 4 => "right",
                _ if button == 2 => "middle",
                _ => return None,
            };
            Some(NativeInput::Button {
                point,
                button,
                pressed: matches!(kind, 1 | 3 | 25),
            })
        }
        5 | 6 | 7 | 27 => Some(NativeInput::Move(point)),
        _ => None,
    }
}

fn observe_mouse(event: &NSEvent, sender: &mpsc::Sender<NativeInput>, state: &MonitorState) {
    if state.stop.load(Ordering::Acquire) {
        return;
    }
    let Some(cg_event) = event.CGEvent() else {
        return;
    };
    let point = unsafe { CGEventGetLocation(Retained::as_ptr(&cg_event).cast_mut().cast()) };
    if let Some(input) = mouse_input(event.r#type().0 as u32, event.buttonNumber() as i64, point) {
        if sender.send(input).is_err() {
            state.error("input_dispatch_disconnected".into());
            state.stop.store(true, Ordering::Release);
        }
    }
}

impl MouseMonitor {
    fn install(
        sender: mpsc::Sender<NativeInput>,
        state: Arc<MonitorState>,
    ) -> Result<Self, String> {
        let mask = NSEventMask::LeftMouseDown
            | NSEventMask::LeftMouseUp
            | NSEventMask::RightMouseDown
            | NSEventMask::RightMouseUp
            | NSEventMask::OtherMouseDown
            | NSEventMask::OtherMouseUp
            | NSEventMask::MouseMoved
            | NSEventMask::LeftMouseDragged
            | NSEventMask::RightMouseDragged
            | NSEventMask::OtherMouseDragged;
        let global_sender = sender.clone();
        let global_state = state.clone();
        let global = RcBlock::new(move |event: NonNull<NSEvent>| {
            observe_mouse(unsafe { event.as_ref() }, &global_sender, &global_state);
        });
        let global = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global)
            .ok_or("input_global_mouse_monitor_failed")?;
        let mut monitor = Self {
            global,
            local: None,
        };
        let local = RcBlock::new(move |event: NonNull<NSEvent>| {
            observe_mouse(unsafe { event.as_ref() }, &sender, &state);
            event.as_ptr()
        });
        monitor.local = Some(
            unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local) }
                .ok_or("input_local_mouse_monitor_failed")?,
        );
        Ok(monitor)
    }
}

pub struct InputMonitor {
    state: Arc<MonitorState>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl Default for InputMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl InputMonitor {
    pub fn new() -> Self {
        Self {
            state: Arc::new(MonitorState {
                running: AtomicBool::new(false),
                stop: AtomicBool::new(false),
                scale: AtomicU64::new(1.0f64.to_bits()),
                window_listener_installed: AtomicBool::new(false),
                error: Mutex::new(None),
                member_resolver: Mutex::new(None),
                auxiliary_hit_test: Mutex::new(None),
            }),
            worker: Mutex::new(None),
        }
    }

    pub fn set_member_resolver<F>(&self, resolver: F) -> Result<(), String>
    where
        F: Fn(f64, f64) -> Option<u64> + Send + Sync + 'static,
    {
        *self
            .state
            .member_resolver
            .lock()
            .map_err(|_| "input_router_lock_poisoned")? = Some(Arc::new(resolver));
        Ok(())
    }

    pub fn set_auxiliary_hit_test<F>(&self, hit_test: F) -> Result<(), String>
    where
        F: Fn(f64, f64) -> bool + Send + Sync + 'static,
    {
        *self
            .state
            .auxiliary_hit_test
            .lock()
            .map_err(|_| "input_auxiliary_hit_test_lock_poisoned")? = Some(Arc::new(hit_test));
        Ok(())
    }

    pub fn status(&self) -> InputStatus {
        self.state.status()
    }

    pub fn start(&self, app: AppHandle) -> Result<InputStatus, String> {
        let result = self.start_inner(app.clone());
        if let Err(error) = &result {
            self.state.error(error.clone());
        }
        let status = self.status();
        app.emit("mac-input-status", &status)
            .map_err(|error| format!("input_status_delivery_failed: {error}"))?;
        result.map(|_| status)
    }

    fn start_inner(&self, app: AppHandle) -> Result<(), String> {
        MainThreadMarker::new().ok_or("Input counters must start on the main thread")?;
        let mut worker = self
            .worker
            .lock()
            .map_err(|_| "input_worker_lock_poisoned")?;
        if self.state.running.load(Ordering::Acquire) {
            return Ok(());
        }
        self.state.stop.store(true, Ordering::Release);
        if let Some(previous) = worker.take() {
            previous.join().map_err(|_| "input_worker_panicked")?;
        }
        MOUSE_MONITOR.with(|slot| slot.borrow_mut().take());
        let window = app
            .get_webview_window("main")
            .ok_or("main_window_missing")?;
        self.state.scale.store(
            window
                .scale_factor()
                .map_err(|error| format!("input_window_scale_failed: {error}"))?
                .to_bits(),
            Ordering::Release,
        );
        if !self
            .state
            .window_listener_installed
            .swap(true, Ordering::AcqRel)
        {
            let state = self.state.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::ScaleFactorChanged { scale_factor, .. } = event {
                    state.scale.store(scale_factor.to_bits(), Ordering::Release);
                }
            });
        }
        *self
            .state
            .error
            .lock()
            .map_err(|_| "input_status_lock_poisoned")? = None;
        self.state.stop.store(false, Ordering::Release);
        let (sender, receiver) = mpsc::channel();
        let mouse = MouseMonitor::install(sender, self.state.clone())?;
        let baseline = keyboard_counter();
        let state = self.state.clone();
        let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
        *worker = Some(
            thread::Builder::new()
                .name("wuwatappo-input".into())
                .spawn(move || {
                    run_monitor(app, state, receiver, baseline, ready_sender);
                })
                .map_err(|error| format!("input_worker_spawn_failed: {error}"))?,
        );
        MOUSE_MONITOR.with(|slot| *slot.borrow_mut() = Some(mouse));
        ready_receiver
            .recv()
            .map_err(|_| "input_worker_initialization_failed".to_string())
    }

    pub fn stop(&self) -> Result<(), String> {
        self.state.stop.store(true, Ordering::Release);
        if MainThreadMarker::new().is_some() {
            MOUSE_MONITOR.with(|slot| slot.borrow_mut().take());
        }
        if let Some(worker) = self
            .worker
            .lock()
            .map_err(|_| "input_worker_lock_poisoned")?
            .take()
        {
            worker.join().map_err(|_| "input_worker_panicked")?;
        }
        Ok(())
    }
}

impl Drop for InputMonitor {
    fn drop(&mut self) {
        if let Err(error) = self.stop() {
            self.state.error(error);
        }
    }
}

pub fn start(app: AppHandle) -> Result<InputStatus, String> {
    app.state::<InputMonitor>().start(app.clone())
}

#[tauri::command]
pub fn get_input_status(app: AppHandle) -> InputStatus {
    app.state::<InputMonitor>().status()
}

#[tauri::command]
pub fn resume_input_monitor(app: AppHandle) -> Result<InputStatus, String> {
    start(app)
}

#[tauri::command]
pub fn request_input_access(app: AppHandle) -> Result<InputStatus, String> {
    // Preserve the existing command; no system permission is requested.
    start(app)
}

#[derive(Debug)]
enum NativeInput {
    Move(Point),
    Button {
        point: Point,
        button: &'static str,
        pressed: bool,
    },
}

#[derive(Clone, Copy, Debug)]
#[repr(C)]
struct Point {
    x: f64,
    y: f64,
}

fn keyboard_counter() -> u32 {
    // HID events only; Apple excludes autorepeat from this cumulative counter.
    unsafe { CGEventSourceCounterForEventType(1, 10) }
}

fn counter_delta(previous: u32, current: u32, elapsed: Duration) -> u32 {
    let delta = current.wrapping_sub(previous);
    // Reset after sleep/long suspension or a Window Server counter reset.
    if elapsed > Duration::from_secs(2) || delta > 4096 {
        0
    } else {
        delta
    }
}

fn dispatch_mouse(
    app: &AppHandle,
    state: &MonitorState,
    routing: &mut MouseRouting,
    input: NativeInput,
) -> Result<(), String> {
    match route_event(input, routing, state)? {
        Some(RoutedInput::Move(position)) => app.emit("mouse-move", position),
        Some(RoutedInput::Button { position, button }) => app
            .emit("mouse-move", position)
            .and_then(|_| app.emit("mouse-button", button)),
        None => return Ok(()),
    }
    .map_err(|error| format!("input_event_delivery_failed: {error}"))
}

fn run_monitor(
    app: AppHandle,
    state: Arc<MonitorState>,
    receiver: mpsc::Receiver<NativeInput>,
    mut previous: u32,
    ready: mpsc::SyncSender<()>,
) {
    let mut routing = MouseRouting::default();
    let mut sampled = Instant::now();
    let interval = Duration::from_millis(50);
    state.running.store(true, Ordering::Release);
    if ready.send(()).is_err() {
        state.stop.store(true, Ordering::Release);
    }
    while !state.stop.load(Ordering::Acquire) {
        let result = match receiver.recv_timeout(interval.saturating_sub(sampled.elapsed())) {
            Ok(input) => dispatch_mouse(&app, &state, &mut routing, input),
            Err(mpsc::RecvTimeoutError::Timeout) => Ok(()),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        if let Err(error) = result {
            state.error(error);
            break;
        }
        let elapsed = sampled.elapsed();
        if elapsed >= interval {
            let current = keyboard_counter();
            let delta = counter_delta(previous, current, elapsed);
            previous = current;
            sampled = Instant::now();
            // This existing clap-only consumer preserves official count storage,
            // reporting gates and pet feedback without inventing key identities.
            for _ in 0..delta {
                if let Err(error) = app.emit("global-clap-mouse", ()) {
                    state.error(format!("input_count_delivery_failed: {error}"));
                    state.stop.store(true, Ordering::Release);
                    break;
                }
            }
        }
    }
    state.running.store(false, Ordering::Release);
    if let Err(error) = app.emit("mac-input-status", state.status()) {
        state.error(format!("input_status_delivery_failed: {error}"));
    }
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceCounterForEventType(state: i32, event_type: u32) -> u32;
    fn CGEventGetLocation(event: *mut c_void) -> Point;
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MouseTarget {
    Main,
    Auxiliary,
}

#[derive(Default)]
struct MouseRouting {
    pressed: BTreeMap<&'static str, MouseTarget>,
}

impl MouseRouting {
    fn button(&mut self, button: &'static str, pressed: bool, over_auxiliary: bool) -> bool {
        if pressed {
            if self.pressed.contains_key(button) {
                return false;
            }
            let target = if over_auxiliary {
                MouseTarget::Auxiliary
            } else {
                MouseTarget::Main
            };
            self.pressed.insert(button, target);
            target == MouseTarget::Main
        } else {
            self.pressed.remove(button) == Some(MouseTarget::Main)
        }
    }

    fn movement(&self, over_auxiliary: bool) -> bool {
        self.pressed
            .values()
            .any(|target| *target == MouseTarget::Main)
            || (self.pressed.is_empty() && !over_auxiliary)
    }
}

#[derive(Debug)]
enum RoutedInput {
    Move(MousePosition),
    Button {
        position: MousePosition,
        button: MouseButton,
    },
}

fn route_event(
    event: NativeInput,
    routing: &mut MouseRouting,
    state: &MonitorState,
) -> Result<Option<RoutedInput>, String> {
    match event {
        NativeInput::Move(point) => {
            let point = physical_mouse_point(point, state);
            let over_auxiliary = over_auxiliary_window(point, state)?;
            if !routing.movement(over_auxiliary) {
                return Ok(None);
            }
            Ok(Some(RoutedInput::Move(resolve_mouse_position(
                point, state,
            )?)))
        }
        NativeInput::Button {
            point,
            button,
            pressed,
        } => {
            let point = physical_mouse_point(point, state);
            // The first down owns the complete gesture. A main-origin drag keeps its
            // up event over an auxiliary window; an auxiliary-origin gesture never
            // reaches the main frontend or its synthetic DOM routing.
            let over_auxiliary = if pressed {
                over_auxiliary_window(point, state)?
            } else {
                false
            };
            if !routing.button(button, pressed, over_auxiliary) {
                return Ok(None);
            }
            let position = resolve_mouse_position(point, state)?;
            Ok(Some(RoutedInput::Button {
                position,
                button: MouseButton {
                    button,
                    action: if pressed { "press" } else { "release" },
                    member_id: position.member_id,
                },
            }))
        }
    }
}

fn physical_mouse_point(point: Point, state: &MonitorState) -> Point {
    let scale = f64::from_bits(state.scale.load(Ordering::Acquire));
    let (x, y) = target_window_physical_point(point.x, point.y, scale);
    Point { x, y }
}

fn over_auxiliary_window(point: Point, state: &MonitorState) -> Result<bool, String> {
    let hit_test = state
        .auxiliary_hit_test
        .lock()
        .map_err(|_| "input_auxiliary_hit_test_lock_poisoned")?
        .clone();
    Ok(hit_test.is_some_and(|hit_test| hit_test(point.x, point.y)))
}

fn resolve_mouse_position(point: Point, state: &MonitorState) -> Result<MousePosition, String> {
    let resolver = state
        .member_resolver
        .lock()
        .map_err(|_| "input_router_lock_poisoned")?
        .clone();
    Ok(MousePosition {
        x: point.x,
        y: point.y,
        member_id: resolver.and_then(|resolve| resolve(point.x, point.y)),
    })
}

fn target_window_physical_point(x: f64, y: f64, scale: f64) -> (f64, f64) {
    // Tao's macOS inner_position is the entire logical global origin multiplied by
    // the target window's backing scale. The frontend subtracts that position and
    // divides by the same scale, including when the window is on a secondary display.
    (x * scale, y * scale)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn auxiliary_test_state() -> Arc<MonitorState> {
        let state = InputMonitor::new().state.clone();
        *state.auxiliary_hit_test.lock().unwrap() = Some(Arc::new(|x, _| x >= 100.0 && x < 200.0));
        *state.member_resolver.lock().unwrap() = Some(Arc::new(|_, _| Some(7)));
        state
    }

    #[test]
    fn cumulative_counters_preserve_bursts_without_replaying_baselines() {
        let sample = Duration::from_millis(50);
        assert_eq!(counter_delta(100, 103, sample), 3);
        assert_eq!(counter_delta(103, 103, sample), 0);
        assert_eq!(counter_delta(u32::MAX - 2, 1, sample), 4);
        assert_eq!(counter_delta(103, 0, sample), 0);
        assert_eq!(counter_delta(103, 110, Duration::from_secs(3)), 0);
    }

    #[test]
    fn counting_does_not_require_a_permission_or_claim_one_is_granted() {
        let monitor = InputMonitor::new();
        let status = serde_json::to_value(monitor.status()).unwrap();
        assert_eq!(status["permissionRequired"], false);
        assert!(status.get("granted").is_none());
        monitor.state.running.store(true, Ordering::Release);
        assert!(monitor.status().running);
        assert_eq!(monitor.status().error, None);
    }

    #[test]
    fn mouse_callbacks_count_supported_buttons_once_and_ignore_scroll_and_extra_buttons() {
        let point = Point { x: 20., y: 30. };
        for (kind, button) in [(1, "left"), (3, "right"), (25, "middle")] {
            assert!(
                matches!(mouse_input(kind, 2, point), Some(NativeInput::Button { button: observed, pressed: true, .. }) if observed == button)
            );
            assert!(
                matches!(mouse_input(kind + 1, 2, point), Some(NativeInput::Button { button: observed, pressed: false, .. }) if observed == button)
            );
        }
        assert!(mouse_input(25, 3, point).is_none());
        assert!(mouse_input(22, 0, point).is_none());
    }

    fn route_button(
        routing: &mut MouseRouting,
        state: &MonitorState,
        x: f64,
        button: &'static str,
        pressed: bool,
    ) -> Option<RoutedInput> {
        route_event(
            NativeInput::Button {
                point: Point { x, y: 50.0 },
                button,
                pressed,
            },
            routing,
            state,
        )
        .unwrap()
    }

    #[test]
    fn panel_dom_clap_is_the_only_count_for_an_auxiliary_click() {
        let state = auxiliary_test_state();
        let mut routing = MouseRouting::default();
        let main_events = [
            route_button(&mut routing, &state, 150.0, "left", true),
            route_button(&mut routing, &state, 150.0, "left", false),
        ];
        let main_press_count = main_events
            .into_iter()
            .flatten()
            .filter(|event| {
                matches!(
                    event,
                    RoutedInput::Button {
                        button: MouseButton {
                            action: "press",
                            ..
                        },
                        ..
                    }
                )
            })
            .count();
        let panel_dom_pet_clap_count = 1; // Original panel onMousedownCapture emits pet-clap once.
        assert_eq!(main_press_count + panel_dom_pet_clap_count, 1);
        assert!(routing.pressed.is_empty());
    }

    #[test]
    fn auxiliary_origin_release_stays_suppressed_outside_auxiliary_window() {
        let state = auxiliary_test_state();
        let mut routing = MouseRouting::default();
        assert!(route_button(&mut routing, &state, 150.0, "left", true).is_none());
        assert!(route_event(
            NativeInput::Move(Point { x: 50.0, y: 50.0 }),
            &mut routing,
            &state
        )
        .unwrap()
        .is_none());
        assert!(route_button(&mut routing, &state, 50.0, "left", false).is_none());
        assert!(routing.pressed.is_empty());
        assert!(matches!(
            route_event(
                NativeInput::Move(Point { x: 50.0, y: 50.0 }),
                &mut routing,
                &state
            )
            .unwrap(),
            Some(RoutedInput::Move(_))
        ));
    }

    #[test]
    fn main_origin_drag_keeps_move_and_release_over_auxiliary_window() {
        let state = auxiliary_test_state();
        let mut routing = MouseRouting::default();
        assert!(matches!(
            route_button(&mut routing, &state, 50.0, "left", true),
            Some(RoutedInput::Button {
                button: MouseButton {
                    action: "press",
                    ..
                },
                ..
            })
        ));
        assert!(matches!(
            route_event(
                NativeInput::Move(Point { x: 150.0, y: 50.0 }),
                &mut routing,
                &state
            )
            .unwrap(),
            Some(RoutedInput::Move(_))
        ));
        assert!(matches!(
            route_button(&mut routing, &state, 150.0, "left", false),
            Some(RoutedInput::Button {
                button: MouseButton {
                    action: "release",
                    ..
                },
                ..
            })
        ));
        assert!(routing.pressed.is_empty());
        assert!(route_event(
            NativeInput::Move(Point { x: 150.0, y: 50.0 }),
            &mut routing,
            &state
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn covered_pet_hover_does_not_resolve_members_or_dispatch_main_dom_input() {
        let state = auxiliary_test_state();
        *state.member_resolver.lock().unwrap() =
            Some(Arc::new(|_, _| panic!("covered pet must not be resolved")));
        let mut routing = MouseRouting::default();
        assert!(route_event(
            NativeInput::Move(Point { x: 150.0, y: 50.0 }),
            &mut routing,
            &state
        )
        .unwrap()
        .is_none());
        assert!(route_button(&mut routing, &state, 150.0, "left", true).is_none());
        assert!(route_button(&mut routing, &state, 50.0, "left", false).is_none());
    }

    #[test]
    fn auxiliary_filter_receives_main_physical_coordinates() {
        let state = auxiliary_test_state();
        state.scale.store(2.0f64.to_bits(), Ordering::Release);
        let mut routing = MouseRouting::default();
        assert!(route_button(&mut routing, &state, 75.0, "left", true).is_none());
        assert!(route_button(&mut routing, &state, 25.0, "left", false).is_none());
    }

    #[test]
    fn simultaneous_buttons_keep_separate_press_owners() {
        let state = auxiliary_test_state();
        let mut routing = MouseRouting::default();
        assert!(route_button(&mut routing, &state, 150.0, "left", true).is_none());
        assert!(route_button(&mut routing, &state, 50.0, "right", true).is_some());
        assert!(route_event(
            NativeInput::Move(Point { x: 150.0, y: 50.0 }),
            &mut routing,
            &state
        )
        .unwrap()
        .is_some());
        assert!(route_button(&mut routing, &state, 150.0, "right", false).is_some());
        assert!(route_button(&mut routing, &state, 50.0, "left", false).is_none());
        assert!(routing.pressed.is_empty());
    }

    #[test]
    fn unobserved_releases_and_duplicate_presses_cannot_create_main_clicks() {
        let state = auxiliary_test_state();
        let mut routing = MouseRouting::default();
        assert!(route_button(&mut routing, &state, 50.0, "left", false).is_none());
        assert!(route_button(&mut routing, &state, 50.0, "left", true).is_some());
        assert!(route_button(&mut routing, &state, 50.0, "left", true).is_none());
        assert!(route_button(&mut routing, &state, 150.0, "left", false).is_some());
    }

    #[test]
    fn physical_coordinates_follow_target_window_scale_on_mixed_dpi() {
        let pointer = (1590.0, 100.0);
        let window_logical_origin = (1512.0, 20.0);
        for scale in [1.0, 2.0] {
            let physical = target_window_physical_point(pointer.0, pointer.1, scale);
            let relative = (
                (physical.0 - window_logical_origin.0 * scale) / scale,
                (physical.1 - window_logical_origin.1 * scale) / scale,
            );
            assert_eq!(relative, (78.0, 80.0));
        }
        assert_eq!(
            target_window_physical_point(-200.0, -20.0, 2.0),
            (-400.0, -40.0)
        );
    }

    #[test]
    fn mouse_payloads_preserve_numeric_members_and_no_extra_coordinate_fields() {
        let movement = serde_json::to_value(MousePosition {
            x: 10.0,
            y: 20.0,
            member_id: Some(5),
        })
        .unwrap();
        assert_eq!(movement["memberId"].as_u64(), Some(5));
        assert_eq!(movement["x"].as_f64(), Some(10.0));
        let button = serde_json::to_value(MouseButton {
            button: "left",
            action: "press",
            member_id: None,
        })
        .unwrap();
        assert_eq!(
            button,
            serde_json::json!({"button":"left","action":"press"})
        );
    }
}
