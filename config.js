'use strict';
require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  eventName: process.env.EVENT_NAME || 'Sự kiện công ty',
  cccdSalt: process.env.CCCD_SALT || 'default-salt-please-change',
  geofence: {
    enabled: String(process.env.GEOFENCE_ENABLED || 'false').toLowerCase() === 'true',
    lat: parseFloat(process.env.GEOFENCE_LAT || '10.762622'),
    lng: parseFloat(process.env.GEOFENCE_LNG || '106.660172'),
    radius: parseFloat(process.env.GEOFENCE_RADIUS || '300'),
  },
};

module.exports = config;
