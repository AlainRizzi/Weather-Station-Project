import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Form, Spinner, Table } from "react-bootstrap";
import { Send, ExclamationTriangle } from "react-bootstrap-icons";
import dayjs from "dayjs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { streamChatMessage } from "../api/client.js";

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

const STAGE_LABELS = {
  classifying: "thinking...",
  generating_sql: "generating query...",
  retrying_query: "adjusting query...",
  running_query: "fetching results...",
  summarizing: "summarizing...",
};
const DEFAULT_STAGE_LABEL = "thinking...";

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
  const [stageLabel, setStageLabel] = useState(DEFAULT_STAGE_LABEL);
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Navigating away mid-reply must NOT cancel the request -- the reply
  // should keep generating in the background so it's there when the user
  // comes back. Only stop touching React state after unmount (it can't
  // render anyway); still write every update straight to sessionStorage so
  // the finished reply is picked up by loadMessages() next time this page
  // mounts.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function persistMessages(updater) {
    const current = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null") ?? [GREETING];
    const next = updater(current);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (mountedRef.current) setMessages(next);
    return next;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map(({ role, text }) => ({ role, text }));

    const assistantId = crypto.randomUUID();
    persistMessages((prev) => [...prev, { role: "user", text, time: Date.now() }]);
    setInput("");
    setStageLabel(DEFAULT_STAGE_LABEL);
    setStreaming(false);
    setLoading(true);

    function upsertAssistantMessage(updateText) {
      persistMessages((prev) => {
        const index = prev.findIndex((m) => m.id === assistantId);
        if (index === -1) {
          return [...prev, { id: assistantId, role: "assistant", text: updateText(""), time: Date.now() }];
        }
        const next = [...prev];
        next[index] = { ...next[index], text: updateText(next[index].text) };
        return next;
      });
    }

    try {
      await streamChatMessage(text, history, (event) => {
        if (event.type === "stage") {
          if (mountedRef.current) setStageLabel(STAGE_LABELS[event.stage] ?? DEFAULT_STAGE_LABEL);
        } else if (event.type === "token") {
          if (mountedRef.current) setStreaming(true);
          upsertAssistantMessage((prevText) => prevText + event.text);
        } else if (event.type === "done") {
          upsertAssistantMessage(() => event.reply);
        } else if (event.type === "error") {
          persistMessages((prev) => [
            ...prev,
            { role: "error", text: event.message || "Sorry, something went wrong answering that.", time: Date.now() },
          ]);
        }
      });
    } catch {
      persistMessages((prev) => [
        ...prev,
        { role: "error", text: "Sorry, something went wrong answering that.", time: Date.now() },
      ]);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setStreaming(false);
      }
    }
  }

  return (
    <>
      <Card className="mb-3 shadow-sm chat-card">
        <Card.Body className="d-flex flex-column gap-2 chat-card-body" style={{ overflowY: "auto" }}>
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
                  className="p-2 rounded-3 bg-accent text-white"
                  style={{ maxWidth: "75%", whiteSpace: "pre-wrap" }}
                >
                  {m.text}
                </div>
              ) : (
                <div className="p-2 rounded-3 bg-assistant-bubble" style={{ maxWidth: "100%" }}>
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
          {loading && !streaming && (
            <div className="d-flex align-items-center gap-2 text-muted">
              <Spinner animation="border" size="sm" /> {stageLabel}
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
        <Button type="submit" disabled={loading} className="btn-accent" aria-label="Send message">
          <Send />
        </Button>
      </Form>
    </>
  );
}
