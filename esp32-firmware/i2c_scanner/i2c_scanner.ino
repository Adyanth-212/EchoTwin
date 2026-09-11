// EchoTwin ESP32 I2C scanner
//
// Flash this before the full sensor node. It scans the fixed I2C bus once
// and reports whether all four expected devices are present.

#include <Wire.h>

constexpr uint8_t I2C_SDA_PIN = 21;
constexpr uint8_t I2C_SCL_PIN = 22;

struct ExpectedDevice {
  uint8_t address;
  const char *name;
  bool found;
};

ExpectedDevice expectedDevices[] = {
    {0x38, "AHT21", false},
    {0x53, "ENS160", false},
    {0x5A, "MLX90614", false},
    {0x68, "MPU-6050", false},
};

constexpr size_t EXPECTED_DEVICE_COUNT =
    sizeof(expectedDevices) / sizeof(expectedDevices[0]);

int expectedDeviceIndex(uint8_t address) {
  for (size_t index = 0; index < EXPECTED_DEVICE_COUNT; index++) {
    if (expectedDevices[index].address == address) {
      return static_cast<int>(index);
    }
  }
  return -1;
}

void printAddress(uint8_t address) {
  Serial.print("0x");
  if (address < 0x10) {
    Serial.print("0");
  }
  Serial.print(address, HEX);
}

void scanI2CBus() {
  Serial.println();
  Serial.println("========================================");
  Serial.println("EchoTwin I2C scan");
  Serial.print("Bus pins: SDA=GPIO");
  Serial.print(I2C_SDA_PIN);
  Serial.print(", SCL=GPIO");
  Serial.println(I2C_SCL_PIN);
  Serial.println("========================================");

  for (size_t index = 0; index < EXPECTED_DEVICE_COUNT; index++) {
    expectedDevices[index].found = false;
  }

  uint8_t foundCount = 0;

  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    uint8_t error = Wire.endTransmission();

    if (error == 0) {
      foundCount++;
      int index = expectedDeviceIndex(address);

      Serial.print("[FOUND] ");
      printAddress(address);

      if (index >= 0) {
        expectedDevices[index].found = true;
        Serial.print(" - ");
        Serial.println(expectedDevices[index].name);
      } else {
        Serial.println(" - unexpected/other I2C device");
      }
    } else if (error == 4) {
      Serial.print("[WARN] Unknown I2C error at ");
      printAddress(address);
      Serial.println();
    }
  }

  Serial.println();
  Serial.println("Expected-device summary:");

  bool allExpectedFound = true;
  for (size_t index = 0; index < EXPECTED_DEVICE_COUNT; index++) {
    Serial.print(expectedDevices[index].found ? "[OK]      " : "[MISSING] ");
    Serial.print(expectedDevices[index].name);
    Serial.print(" @ ");
    printAddress(expectedDevices[index].address);
    Serial.println();

    if (!expectedDevices[index].found) {
      allExpectedFound = false;
    }
  }

  Serial.println();
  Serial.print("Total responding I2C addresses: ");
  Serial.println(foundCount);

  if (allExpectedFound) {
    Serial.println("RESULT: PASS - all 4 expected devices responded.");
  } else {
    Serial.println("RESULT: CHECK WIRING - one or more expected devices are missing.");
  }

  Serial.println("Scan complete. Reset the ESP32 to scan again.");
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);
  scanI2CBus();
}

void loop() {
  delay(1000);
}
