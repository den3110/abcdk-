// src/utils/analytics.js
import ReactGA from "react-ga4";

const TRACKING_ID = "G-BK01KVL8V8"; // Measurement ID từ GA4

export const initGA = () => {
  ReactGA.initialize(TRACKING_ID, {
    gtagOptions: {
      send_page_view: false, // Tắt auto page view
    },
  });
};

// Track page views
export const logPageView = (path, title) => {
  ReactGA.send({
    hitType: "pageview",
    page: path,
    title: title,
  });
};

// Track events
export const logEvent = (category, action, label) => {
  ReactGA.event({
    category: category,
    action: action,
    label: label,
  });
};

// Track custom events
export const logCustomEvent = (eventName, params = {}) => {
  ReactGA.event(eventName, params);
};

// Track user properties
export const setUserProperties = (userId, properties) => {
  ReactGA.set({ userId: userId, ...properties });
};
