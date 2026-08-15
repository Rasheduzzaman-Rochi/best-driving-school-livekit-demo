import logging

import pytest
from livekit.agents import AgentSession, metrics
from livekit.agents.voice.events import MetricsCollectedEvent

from agent import (
    ENDPOINTING_OPTIONS,
    FISH_AUDIO_EXTRA_KWARGS,
    PREEMPTIVE_GENERATION_OPTIONS,
    Assistant,
    _install_latency_logging,
    check_available_slots_impl,
    create_booking_impl,
)


@pytest.mark.asyncio
async def test_check_available_slots_returns_all_backend_slots(monkeypatch) -> None:
    async def fake_post(path, payload):
        assert path == "/api/availability"
        assert payload == {
            "booking_date": "2026-08-18",
            "service_type": "adult_driving_lesson",
        }
        return {
            "available": True,
            "closed": False,
            "booking_date": "2026-08-18",
            "service_type": "adult_driving_lesson",
            "available_slots": [
                {
                    "start_time": "09:00",
                    "end_time": "11:00",
                    "label": "9:00 AM to 11:00 AM",
                },
                {
                    "start_time": "15:00",
                    "end_time": "17:00",
                    "label": "3:00 PM to 5:00 PM",
                },
            ],
        }

    monkeypatch.setattr("agent._post_booking_api", fake_post)

    result = await check_available_slots_impl(
        "2026-08-18",
        "adult_driving_lesson",
    )

    assert "Available adult driving lesson slots for 2026-08-18" in result
    assert "9:00 AM to 11:00 AM" in result
    assert "3:00 PM to 5:00 PM" in result
    assert "Do not offer any time that is not listed" in result


@pytest.mark.asyncio
async def test_check_available_slots_reports_closed_day(monkeypatch) -> None:
    async def fake_post(path, payload):
        return {
            "available": False,
            "closed": True,
            "booking_date": payload["booking_date"],
            "service_type": payload["service_type"],
            "available_slots": [],
        }

    monkeypatch.setattr("agent._post_booking_api", fake_post)

    result = await check_available_slots_impl("2026-08-21")

    assert "closed on 2026-08-21" in result
    assert "No lesson slots are available" in result


@pytest.mark.asyncio
async def test_create_booking_reports_exact_confirmed_time(monkeypatch) -> None:
    async def fake_post(path, payload):
        assert path == "/api/bookings"
        assert payload["customer_name"] == "LiveKit Test User"
        assert payload["callback_number"] == "469-555-0199"
        return {
            "success": True,
            "booking_date": "2026-08-18",
            "start_time": "13:00",
            "end_time": "15:00",
            "status": "confirmed",
        }

    monkeypatch.setattr("agent._post_booking_api", fake_post)

    result = await create_booking_impl(
        customer_name="LiveKit Test User",
        callback_number="469-555-0199",
        service_type="adult_driving_lesson",
        booking_date="2026-08-18",
        start_time="13:00",
    )

    assert "Booking succeeded" in result
    assert "Confirmed date: 2026-08-18" in result
    assert "Confirmed time: 1:00 PM to 3:00 PM" in result


@pytest.mark.asyncio
async def test_create_booking_conflict_returns_alternatives(monkeypatch) -> None:
    async def fake_post(path, payload):
        return {
            "success": False,
            "reason": "slot_already_booked",
            "message": "That time slot is no longer available.",
            "available_slots": [
                {
                    "start_time": "15:00",
                    "end_time": "17:00",
                    "label": "3:00 PM to 5:00 PM",
                }
            ],
        }

    monkeypatch.setattr("agent._post_booking_api", fake_post)

    result = await create_booking_impl(
        customer_name="LiveKit Test User",
        callback_number="469-555-0199",
        service_type="adult_driving_lesson",
        booking_date="2026-08-18",
        start_time="13:00",
    )

    assert "Booking was not completed" in result
    assert "3:00 PM to 5:00 PM" in result
    assert "no longer available" in result


def test_assistant_registers_booking_tools() -> None:
    assistant = Assistant()

    tool_ids = {tool.id for tool in assistant.tools}

    assert "check_available_slots" in tool_ids
    assert "create_booking" in tool_ids


def test_latency_tuning_options_are_preserved() -> None:
    assert ENDPOINTING_OPTIONS == {
        "mode": "dynamic",
        "min_delay": 0.30,
        "max_delay": 1.20,
    }
    assert PREEMPTIVE_GENERATION_OPTIONS == {
        "enabled": True,
        "preemptive_tts": True,
    }
    assert FISH_AUDIO_EXTRA_KWARGS == {"latency": "low"}


@pytest.mark.asyncio
async def test_latency_logger_reports_complete_turn(caplog) -> None:
    session = AgentSession()
    _install_latency_logging(session)

    caplog.set_level(logging.INFO, logger="agent")
    session.emit(
        "metrics_collected",
        MetricsCollectedEvent(
            metrics=metrics.EOUMetrics(
                timestamp=1.0,
                end_of_utterance_delay=0.3,
                transcription_delay=0.0,
                on_user_turn_completed_delay=0.0,
                speech_id="speech-1",
            )
        ),
    )
    session.emit(
        "metrics_collected",
        MetricsCollectedEvent(
            metrics=metrics.LLMMetrics(
                label="llm",
                request_id="llm-1",
                timestamp=1.1,
                duration=1.0,
                ttft=0.4,
                cancelled=False,
                completion_tokens=5,
                prompt_tokens=10,
                prompt_cached_tokens=0,
                total_tokens=15,
                tokens_per_second=5.0,
                speech_id="speech-1",
            )
        ),
    )
    session.emit(
        "metrics_collected",
        MetricsCollectedEvent(
            metrics=metrics.TTSMetrics(
                label="tts",
                request_id="tts-1",
                timestamp=1.2,
                ttfb=0.2,
                duration=1.0,
                audio_duration=1.0,
                cancelled=False,
                characters_count=20,
                streamed=True,
                speech_id="speech-1",
            )
        ),
    )

    assert "LATENCY | EOU=0.30s | LLM=0.40s | TTS=0.20s | TOTAL=0.90s" in caplog.text
