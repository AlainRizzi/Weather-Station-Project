from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.models import ChatLog
from app.services.chatbot import classify_and_reply

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


@router.post("", response_model=ChatOut)
def chat(payload: ChatIn, db: Session = Depends(get_db)):
    history = [(m.role, m.text) for m in payload.history[-10:]]

    try:
        result = classify_and_reply(payload.message, db, history)
    except ValueError as e:
        raise HTTPException(400, str(e))

    db.add(
        ChatLog(
            user_message=payload.message,
            intent=result["intent"],
            generated_sql=result["sql"],
            reply=result["reply"],
        )
    )
    db.commit()

    return ChatOut(reply=result["reply"], intent=result["intent"], sql=result["sql"])
