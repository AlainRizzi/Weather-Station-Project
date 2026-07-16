import { Container, Nav, Navbar } from "react-bootstrap";
import { CloudSun, ChatDots, GraphUp } from "react-bootstrap-icons";
import { Link, Outlet } from "react-router";

export default function AppLayout() {
  return (
    <>
      <Navbar bg="dark" data-bs-theme="dark" expand="sm">
        <Container>
          <Navbar.Brand as={Link} to="/">
            <CloudSun className="me-2" />
            Weather Station
          </Navbar.Brand>
          <Nav className="ms-auto">
            <Nav.Link as={Link} to="/">
              Dashboard
            </Nav.Link>
            <Nav.Link as={Link} to="/graphs">
              <GraphUp className="me-1" />
              Graphs
            </Nav.Link>
            <Nav.Link as={Link} to="/chat">
              <ChatDots className="me-1" />
              Chat
            </Nav.Link>
          </Nav>
        </Container>
      </Navbar>
      <Container className="py-4">
        <Outlet />
      </Container>
    </>
  );
}
