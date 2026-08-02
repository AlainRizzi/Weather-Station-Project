import { Button, Container, Nav, Navbar } from "react-bootstrap";
import { CloudSun, ChatDots, GraphUp, HouseDoorFill, Sun, MoonStars } from "react-bootstrap-icons";
import { Link, Outlet, useLocation } from "react-router";

import { useTheme } from "../theme/ThemeContext.jsx";

export default function AppLayout() {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const themeToggleLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

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
            <Nav className="ms-auto align-items-md-center">
              <Button
                variant="link"
                className="nav-link d-flex align-items-center p-0 me-md-3"
                onClick={toggleTheme}
                aria-label={themeToggleLabel}
                title={themeToggleLabel}
              >
                {theme === "dark" ? <Sun /> : <MoonStars />}
              </Button>
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
