#pragma once
// ===== MAU CAU HINH - chep thanh config.h roi dien thong tin =====
// WiFi (ESP32 chi ho tro 2.4GHz)
#define WIFI_SSID_CFG     "TEN_WIFI"
#define WIFI_PASSWORD_CFG "MAT_KHAU_WIFI"

// Phai TRUNG voi id bai do trong database / app
#define PARKING_ID "sp-demo-01"

// Broker MQTT. Bo 4 dong nay -> dung broker cong khai broker.hivemq.com:1883
// HiveMQ Cloud: cong 8883 (TLS), user/pass tao trong muc Access Management
#define MQTT_HOST_CFG "xxxxxxxx.s1.eu.hivemq.cloud"
#define MQTT_PORT_CFG 8883
#define MQTT_USER_CFG "esp32-sp-demo-01"
#define MQTT_PASS_CFG "MAT_KHAU_MQTT"
