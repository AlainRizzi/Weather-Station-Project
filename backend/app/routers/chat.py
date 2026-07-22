import json
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.models import ChatLog
from app.services.chatbot import classify_and_reply

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: str
    text: str


class ChatIn(BaseModel):
    message: str
    history: list[ChatMessage] = []


class ChatOut(BaseModel):
    reply: str
    intent: str
    sql: str | None = None


def sse_event(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def stream_chat_response(message: str, db: Session, history: list[tuple[str, str]]):
    pipeline = classify_and_reply(message, db, history)
    result = None
    try:
        while True:
            event = next(pipeline)
            yield sse_event(event)
    except StopIteration as stop:
        result = stop.value
    except ValueError as e:
        yield sse_event({"type": "error", "message": str(e)})
        return
    except Exception:
        logger.exception("stream_chat_response: pipeline failed for message %r", message)
        yield sse_event({"type": "error", "message": "Something went wrong answering that."})
        return

    db.add(
        ChatLog(
            user_message=message,
            intent=result["intent"],
            generated_sql=result["sql"],
            reply=result["reply"],
        )
    )
    db.commit()

    yield sse_event({"type": "done", **result})


@router.post("")
def chat(payload: ChatIn, db: Session = Depends(get_db)):
    history = [(m.role, m.text) for m in payload.history[-10:]]

    return StreamingResponse(
        stream_chat_response(payload.message, db, history),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
