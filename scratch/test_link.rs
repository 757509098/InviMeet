extern "C" {
    fn mac_check_screen_capture_permission() -> bool;
    fn mac_request_screen_capture_permission() -> bool;
}

fn main() {
    let has_perm = unsafe { mac_check_screen_capture_permission() };
    println!("ScreenCapture Permission: {}", has_perm);
}
