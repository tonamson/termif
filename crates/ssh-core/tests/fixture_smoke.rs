mod common;

#[test]
fn fixture_is_reachable_when_docker_is_up() {
    require_server!();
    assert!(common::TestServer::is_available());
}
