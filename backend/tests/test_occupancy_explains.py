from app import anomaly, config


def configure(monkeypatch, minimum=5):
    monkeypatch.setattr(config, "OCCUPANCY_EXPLAINS_AIR_MIN_PEOPLE", minimum)


def test_crowd_explains_air_quality_only_anomaly(monkeypatch):
    configure(monkeypatch)
    assert anomaly.occupancy_explains_anomaly(["eco2", "tvoc"], 9) is True


def test_humidity_and_aqi_are_also_explained(monkeypatch):
    configure(monkeypatch)
    assert anomaly.occupancy_explains_anomaly(["humidity", "aqi"], 6) is True


def test_quiet_room_explains_nothing(monkeypatch):
    configure(monkeypatch)
    assert anomaly.occupancy_explains_anomaly(["eco2", "tvoc"], 2) is False


def test_missing_occupancy_explains_nothing(monkeypatch):
    configure(monkeypatch)
    assert anomaly.occupancy_explains_anomaly(["eco2"], None) is False


def test_vibration_is_never_suppressed(monkeypatch):
    """The dangerous case: a busy room must not mask an equipment fault."""
    configure(monkeypatch)
    assert anomaly.occupancy_explains_anomaly(["vibration_magnitude"], 40) is False
    assert anomaly.occupancy_explains_anomaly(["vibration_trip"], 40) is False


def test_surface_temperature_is_never_suppressed(monkeypatch):
    configure(monkeypatch)
    assert anomaly.occupancy_explains_anomaly(["surface_temp"], 40) is False


def test_air_temperature_is_never_suppressed(monkeypatch):
    # Bodies warm a room, but this is also the overheating signal.
    configure(monkeypatch)
    assert anomaly.occupancy_explains_anomaly(["temperature"], 40) is False


def test_one_unexplained_feature_keeps_the_anomaly(monkeypatch):
    """A mixed cause is still a fault — the crowd is not the whole story."""
    configure(monkeypatch)
    assert anomaly.occupancy_explains_anomaly(["eco2", "surface_temp"], 30) is False


def test_empty_feature_list_explains_nothing(monkeypatch):
    configure(monkeypatch)
    assert anomaly.occupancy_explains_anomaly([], 30) is False


def test_threshold_boundary_is_inclusive(monkeypatch):
    configure(monkeypatch, minimum=5)
    assert anomaly.occupancy_explains_anomaly(["eco2"], 5) is True
    assert anomaly.occupancy_explains_anomaly(["eco2"], 4) is False
