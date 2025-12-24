import { WeatherTestCase } from '../types/weather';

/* 1. DAILY FORECAST */
export const DAILY_FORECAST_TEST_CASES: WeatherTestCase[] = [
  {
    id: 1,
    name: 'EN - now, no location',
    message: 'Tell me the weather now',
    subIntent: 'CheckDailyForecast',
  },
  {
    id: 2,
    name: 'EN - today Hanoi',
    message: 'Tell me the weather in Hanoi today',
    subIntent: 'CheckDailyForecast',
  },
  {
    id: 3,
    name: 'EN - Hanoi +2 days',
    message: '2 days later Hanoi Weather',
    subIntent: 'CheckDailyForecast',
  },
  {
    id: 4,
    name: 'EN - today generic #1',
    message: "What's the weather like today?",
    subIntent: 'CheckDailyForecast',
  },
  {
    id: 5,
    name: 'EN - New York +3h',
    message: 'Tell me the weather in New York in 3 hours',
    subIntent: 'CheckDailyForecast',
  },
  {
    id: 6,
    name: 'EN - raining now',
    message: 'Is it raining right now?',
    subIntent: 'CheckDailyForecast',
  },
  {
    id: 7,
    name: 'EN - sunny or rainy',
    message: 'Is it sunny or rainy out there?',
    subIntent: 'CheckDailyForecast',
  },
  {
    id: 8,
    name: 'EN - this week',
    message: 'Show me the weather for this week.',
    subIntent: 'CheckDailyForecast',
  },
  {
    id: 9,
    name: 'EN - next few days',
    message: 'Give me the weather forecast for the next few days.',
    subIntent: 'CheckDailyForecast',
  },
  {
    id: 10,
    name: 'EN - next few days',
    message: 'Give me the weather forecast for the next week.',
    subIntent: 'CheckDailyForecast',
  },
];

/* 2. HOURLY FORECAST */
export const HOURLY_FORECAST_TEST_CASES: WeatherTestCase[] = [
  {
    id: 1,
    name: 'EN - hourly Hanoi',
    message: 'Tell me the hourly weather in Hanoi',
    subIntent: 'CheckHourlyForecast',
  },
  {
    id: 2,
    name: 'EN - Hanoi +2h',
    message: 'Tell me the weather in Hanoi 2 hours later from now',
    subIntent: 'CheckHourlyForecast',
  },
  {
    id: 3,
    name: 'EN - duration',
    message: 'Tell me the hourly weather in Hanoi from 3 hours later for 4 hours',
    subIntent: 'CheckHourlyForecast',
  },
  {
    id: 4,
    name: 'EN - rain today Hanoi',
    message: 'Will it rain in Hanoi today?',
    subIntent: 'CheckHourlyForecast',
  }
];

/* 3. TEMPERATURE */
export const TEMPERATURE_TEST_CASES: WeatherTestCase[] = [
  {
    id: 1,
    name: 'EN - temp today Hanoi',
    message: 'Tell me today’s temperature in Hanoi',
    subIntent: 'CheckTemperature',
  },
  {
    id: 2,
    name: 'EN - weekly temp range Hanoi',
    message: "Show me this week's temperature range in Hanoi!??",
    subIntent: 'CheckTemperature',
  },
  {
    id: 3,
    name: 'EN - temp now',
    message: "What's the temperature outside right now?",
    subIntent: 'CheckTemperature',
  },
  {
    id: 4,
    name: 'EN - how many degrees',
    message: 'How many degrees is it out there?',
    subIntent: 'CheckTemperature',
  },
  {
    id: 5,
    name: 'EN - max/min temp',
    message: 'Can you give me the maximum and minimum temperatures?',
    subIntent: 'CheckTemperature',
  },
];

/* 4. AIR QUALITY */
export const AIR_QUALITY_TEST_CASES: WeatherTestCase[] = [
  {
    id: 1,
    name: 'EN - today AQ',
    message: "Show me today's air quality.",
    subIntent: 'CheckAirQuality',
  },
  {
    id: 2,
    name: 'EN - air clean here',
    message: 'Is the air clean here?',
    subIntent: 'CheckAirQuality',
  },
  {
    id: 3,
    name: 'EN - Saigon AQ',
    message: 'Is the air quality good in Saigon today?',
    subIntent: 'CheckAirQuality',
  },
  {
    id: 4,
    name: 'EN - AQ Hanoi +2h',
    message: '2 hours later Hanoi air quality',
    subIntent: 'CheckAirQuality',
  },
  {
    id: 5,
    name: 'EN - fine dust Hanoi',
    message: 'Tell me the fine dust level in Hanoi for 3 hours from 10pm',
    subIntent: 'CheckAirQuality',
  },
];

export const WEEKLY_FORECAST_TEST_CASES: WeatherTestCase[] = [
    {
        id: 1,
        name: 'EN - this week Hanoi',
        message: 'tell me the weather in hanoi this week',
        subIntent: 'CheckWeeklyForecast',
    },
    {
        id: 2,
        name: 'EN - this week Hanoi',
        message: 'tell me the weather in hanoi next week',
        subIntent: 'CheckWeeklyForecast',
    },
];
