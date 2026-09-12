def evaluate_rules(sensors):
    status = "green"
    suggestions = []

    def warn(message):
        nonlocal status
        if status == "green":
            status = "yellow"
        suggestions.append(message)

    def critical(message):
        nonlocal status
        status = "red"
        suggestions.append(message)

    occupancy = sensors.get("occupancy_count")
    temperature = sensors.get("temperature")
    humidity = sensors.get("humidity")
    eco2 = sensors.get("eco2")
    tvoc = sensors.get("tvoc")
    aqi = sensors.get("aqi")
    surface_temp = sensors.get("surface_temp")
    vibration = sensors.get("vibration_magnitude")
    vibration_trip = sensors.get("vibration_trip")

    if occupancy is not None:
        if occupancy >= 30:
            critical("Severe overcrowding detected — redirect people immediately.")
        elif occupancy >= 20:
            warn("Occupancy is elevated — consider redirecting traffic.")

    if temperature is not None:
        if temperature >= 35:
            critical("Ambient temperature is very high — inspect cooling or ventilation.")
        elif temperature >= 30:
            warn("Room temperature is above the preferred range.")

    if humidity is not None:
        if humidity < 20 or humidity > 80:
            critical("Humidity is outside the safe operating range.")
        elif humidity < 30 or humidity > 70:
            warn("Humidity is outside the preferred range.")

    if eco2 is not None:
        if eco2 >= 1500:
            critical("Estimated CO2 is high — ventilate and inspect the area.")
        elif eco2 >= 1000:
            warn("Estimated CO2 is rising — consider increasing ventilation.")

    if tvoc is not None:
        if tvoc >= 600:
            critical("TVOC is high — ventilate and inspect possible sources.")
        elif tvoc >= 300:
            warn("TVOC is elevated — consider increasing ventilation.")

    if aqi is not None:
        if aqi >= 5:
            critical("Air quality is poor — ventilate and inspect the area.")
        elif aqi >= 4:
            warn("Air quality is deteriorating — consider increasing ventilation.")

    if surface_temp is not None:
        if surface_temp >= 45:
            critical("High surface temperature detected — inspect nearby equipment.")
        elif surface_temp >= 40:
            warn("Surface temperature is elevated.")

    if vibration is not None:
        if vibration >= 5:
            critical("Strong vibration detected — inspect equipment immediately.")
        elif vibration >= 2.5:
            warn("Vibration is elevated — equipment inspection is recommended.")

    if vibration_trip:
        warn("The vibration trip sensor was triggered — inspect nearby equipment.")

    if (
        temperature is not None
        and vibration is not None
        and temperature >= 30
        and vibration >= 2.5
    ):
        critical(
            "Combined heat and vibration may indicate equipment stress or an "
            "emerging fault."
        )

    return status, suggestions
