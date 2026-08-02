import { Container, Nav, Navbar } from "react-bootstrap";
import { CloudSun, ChatDots, GraphUp, HouseDoorFill } from "react-bootstrap-icons";
import { Link, Outlet, useLocation } from "react-router";

export default function AppLayout() {
  const { pathname } = useLocation();

  return (
    <>
      <Navbar bg="dark" data-bs-theme="dark" expand="md">
        <Container>
          <Navbar.Brand as={Link} to="/" className="d-flex align-items-center">
            <CloudSun className="me-2" />
            Weather Station
          </Navbar.Brand>
          <Navbar.Toggle aria-controls="main-nav" />
          <Navbar.Collapse id="main-nav">
            <Nav className="ms-auto">
              <Nav.Link as={Link} to="/" active={pathname === "/"} className="d-flex align-items-center">
                <HouseDoorFill className="me-1" />
                Dashboard
              </Nav.Link>
              <Nav.Link as={Link} to="/graphs" active={pathname === "/graphs"} className="d-flex align-items-center">
                <GraphUp className="me-1" />
                Graphs
              </Nav.Link>
              <Nav.Link as={Link} to="/chat" active={pathname === "/chat"} className="d-flex align-items-center">
                <ChatDots className="me-1" />
                Chat
              </Nav.Link>
            </Nav>
          </Navbar.Collapse>
        </Container>
      </Navbar>
      <Container className="py-4">
        <Outlet />
      </Container>
    </>
  );
}
