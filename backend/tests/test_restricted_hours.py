from datetime import datetime, timezone

from app import config, rules


def at_utc(hour, minute=0):
    return datetime(2026, 9, 13, hour, minute, tzinfo=timezone.utc)


def configure(monkeypatch, start, end, offset_minutes=330):
    monkeypatch.setattr(config, "RESTRICTED_HOURS_START", start)
    monkeypatch.setattr(config, "RESTRICTED_HOURS_END", end)
    monkeypatch.setattr(config, "RESTRICTED_HOURS_UTC_OFFSET_MINUTES", offset_minutes)


def test_disabled_by_default(monkeypatch):
    configure(monkeypatch, "", "")
    assert rules.in_restricted_hours(at_utc(20)) is False


def test_equal_bounds_disable_the_rule(monkeypatch):
    configure(monkeypatch, "22:00", "22:00")
    assert rules.in_restricted_hours(at_utc(16, 30)) is False


def test_window_crossing_midnight(monkeypatch):
    # 22:00 -> 06:00 IST. 18:00 UTC is 23:30 IST, inside the window.
    configure(monkeypatch, "22:00", "06:00")
    assert rules.in_restricted_hours(at_utc(18, 0)) is True
    # 09:00 UTC is 14:30 IST, outside it.
    assert rules.in_restricted_hours(at_utc(9, 0)) is False


def test_window_within_one_day(monkeypatch):
    # 09:00 -> 17:00 IST. 06:00 UTC is 11:30 IST, inside.
    configure(monkeypatch, "09:00", "17:00")
    assert rules.in_restricted_hours(at_utc(6, 0)) is True
    assert rules.in_restricted_hours(at_utc(18, 0)) is False


def test_offset_is_applied(monkeypatch):
    # Same instant, read as UTC instead of IST, falls outside the window.
    configure(monkeypatch, "22:00", "06:00", offset_minutes=0)
    assert rules.in_restricted_hours(at_utc(18, 0)) is False


def test_occupancy_during_restricted_hours_is_critical(monkeypatch):
    configure(monkeypatch, "22:00", "06:00")
    status, suggestions = rules.evaluate_rules({"occupancy_count": 2}, now=at_utc(18))
    assert status == "red"
    assert any("restricted hours" in line for line in suggestions)


def test_empty_room_during_restricted_hours_is_clean(monkeypatch):
    configure(monkeypatch, "22:00", "06:00")
    status, suggestions = rules.evaluate_rules({"occupancy_count": 0}, now=at_utc(18))
    assert status == "green"
    assert suggestions == []


def test_occupancy_outside_restricted_hours_is_clean(monkeypatch):
    configure(monkeypatch, "22:00", "06:00")
    status, suggestions = rules.evaluate_rules({"occupancy_count": 2}, now=at_utc(9))
    assert status == "green"
    assert suggestions == []


def test_malformed_bounds_do_not_raise(monkeypatch):
    configure(monkeypatch, "not-a-time", "06:00")
    assert rules.in_restricted_hours(at_utc(18)) is False
