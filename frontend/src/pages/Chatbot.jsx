import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Form, Spinner, Table } from "react-bootstrap";
import { Send, ExclamationTriangle } from "react-bootstrap-icons";
import dayjs from "dayjs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { sendChatMessage } from "../api/client.js";

const markdownComponents = {
  table: ({ ...props }) => (
    <div style={{ overflowX: "auto" }}>
      <Table striped bordered size="sm" className="mb-0" {...props} />
    </div>
  ),
  p: ({ ...props }) => <p className="mb-0" {...props} />,
};

const STORAGE_KEY = "chat_messages";
const GREETING = {
  role: "assistant",
  text: "Hi! Ask me about the weather station's data, e.g. \"what was last week's highest temperature?\"",
  time: Date.now(),
};

const LOADING_STAGES = ["thinking...", "generating query...", "fetching results...", "summarizing..."];
const STAGE_INTERVAL_MS = 1800;

function loadMessages() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // ignore corrupt storage, fall back to greeting
  }
  return [GREETING];
}

export default function Chatbot() {
  const [messages, setMessages] = useState(loadMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const bottomRef = useRef(null);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, LOADING_STAGES.length - 1));
    }, STAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loading]);

  async function handleSubmit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map(({ role, text }) => ({ role, text }));

    setMessages((prev) => [...prev, { role: "user", text, time: Date.now() }]);
    setInput("");
    setStageIndex(0);
    setLoading(true);

    try {
      const { reply } = await sendChatMessage(text, history);
      setMessages((prev) => [...prev, { role: "assistant", text: reply, time: Date.now() }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "error", text: "Sorry, something went wrong answering that.", time: Date.now() },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="mb-3">Ask the Station</h1>
      <Card className="mb-3 shadow-sm" style={{ minHeight: "60vh" }}>
        <Card.Body className="d-flex flex-column gap-2" style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {messages.map((m, i) => (
            <div
              key={i}
              className={`d-flex flex-column ${m.role === "user" ? "align-items-end" : "align-items-start"}`}
            >
              {m.role === "error" ? (
                <Alert variant="danger" className="d-flex align-items-center gap-2 py-2 mb-0" style={{ maxWidth: "75%" }}>
                  <ExclamationTriangle /> {m.text}
                </Alert>
              ) : m.role === "user" ? (
                <div
                  className="p-2 rounded-3 bg-primary text-white"
                  style={{ maxWidth: "75%", whiteSpace: "pre-wrap" }}
                >
                  {m.text}
                </div>
              ) : (
                <div className="p-2 rounded-3 bg-light" style={{ maxWidth: "100%" }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {m.text}
                  </ReactMarkdown>
                </div>
              )}
              {m.time && (
                <div className="text-muted" style={{ fontSize: "0.7rem" }}>
                  {dayjs(m.time).format("HH:mm")}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="d-flex align-items-center gap-2 text-muted">
              <Spinner animation="border" size="sm" /> {LOADING_STAGES[stageIndex]}
            </div>
          )}
          <div ref={bottomRef} />
        </Card.Body>
      </Card>
      <Form onSubmit={handleSubmit} className="d-flex gap-2">
        <Form.Control
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          disabled={loading}
          autoFocus
        />
        <Button type="submit" disabled={loading}>
          <Send />
        </Button>
      </Form>
    </>
  );
}
