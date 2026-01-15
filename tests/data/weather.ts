import { TestCase } from '../types/type';

/* =========================
   DAILY FORECAST
========================= */
export const DAILY_FORECAST_TEST_CASES: TestCase[] = [
  {
    id: 1,
    name: 'EN - now, Hanoi',
    message: 'hanoi weather right now',
    subIntent: 'CheckDailyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 2,
    name: 'EN - sunny or cloudy',
    message: 'Is it sunny or cloudy?',
    subIntent: 'CheckDailyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 3,
    name: 'EN - rain today',
    message: 'Will it rain today?',
    subIntent: 'CheckDailyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 4,
    name: 'EN - today Hanoi',
    message: 'Tell me the weather in Hà Nội today',
    subIntent: 'CheckDailyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 5,
    name: 'EN - today New York',
    message: 'Tell me the weather in New York today',
    subIntent: 'CheckDailyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 6,
    name: 'EN - tomorrow Hanoi',
    message: 'Tell me tomorrow’s weather in Hanoi',
    subIntent: 'CheckDailyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 7,
    name: 'EN - this evening',
    message: "tell me this evening's weather",
    subIntent: 'CheckDailyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 8,
    name: 'EN - today London',
    message: "how's the weather in London today",
    subIntent: 'CheckDailyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 9,
    name: 'EN - today London Canada',
    message: "how's the weather in London, Canada today",
    subIntent: 'CheckDailyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
];

/* =========================
   WEEKLY FORECAST
========================= */
export const WEEKLY_FORECAST_TEST_CASES: TestCase[] = [
  {
    id: 1,
    name: 'EN - 2 days later',
    message: '2 days later Hanoi Weather',
    subIntent: 'CheckWeeklyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 2,
    name: 'EN - this week',
    message: 'tell me the weather in hanoi this week',
    subIntent: 'CheckWeeklyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 3,
    name: 'EN - next week',
    message: 'tell me the weather in hanoi next week',
    subIntent: 'CheckWeeklyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
];

/* =========================
   TEMPERATURE
========================= */
export const TEMPERATURE_TEST_CASES: TestCase[] = [
  {
    id: 1,
    name: 'EN - now temperature',
    message: 'Tell me temperature in Hanoi right now',
    subIntent: 'CheckTemperature',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 2,
    name: 'EN - today temperature',
    message: 'Tell me the weather in Hà Nội today',
    subIntent: 'CheckTemperature',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 3,
    name: 'EN - tomorrow temperature',
    message: 'Tell me tomorrow’s temperature in Hanoi',
    subIntent: 'CheckTemperature',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 4,
    name: 'EN - range this week',
    message: 'tell me the temperature range in hanoi this week',
    subIntent: 'CheckTemperature',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 5,
    name: 'EN - range next week',
    message: 'tell me the temperature range in hanoi next week',
    subIntent: 'CheckTemperature',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 6,
    name: 'EN - min max',
    message: 'Tell me min and max temperature in Hanoi',
    subIntent: 'CheckTemperature',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
];

/* =========================
   AIR QUALITY
========================= */
export const AIR_QUALITY_TEST_CASES: TestCase[] = [
  {
    id: 1,
    name: 'EN - current air quality',
    message: 'currently Hanoi air quality',
    subIntent: 'CheckAirQuality',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 2,
    name: 'EN - today air quality',
    message: 'today Hanoi air quality',
    subIntent: 'CheckAirQuality',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 3,
    name: 'VI - current air quality',
    message: 'Tình trạng chất lượng không khí ở Hà Nội bây giờ như thế nào',
    subIntent: 'CheckAirQuality',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 4,
    name: 'EN - 2 hours later',
    message: '2 hours later Hanoi air quality',
    subIntent: 'CheckAirQuality',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 5,
    name: 'EN - 4 hours from 2 hours later',
    message: 'Hanoi air quality for 4 hours from 2 hours later',
    subIntent: 'CheckAirQuality',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 6,
    name: 'EN - next 6 hours',
    message: 'Is the air clear for next 6 hours',
    subIntent: 'CheckAirQuality',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 7,
    name: 'EN - tomorrow air quality',
    message: 'tomorrow Hanoi air quality',
    subIntent: 'CheckAirQuality',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
];

/* =========================
   HOURLY FORECAST
========================= */
export const HOURLY_FORECAST_TEST_CASES: TestCase[] = [
  {
    id: 1,
    name: 'EN - hourly',
    message: 'Tell me the hourly weather in Hanoi',
    subIntent: 'CheckHourlyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 2,
    name: 'EN - from 3 hours later for 4 hours',
    message: 'Tell me the hourly weather in Hanoi from 3 hours later for 4 hours',
    subIntent: 'CheckHourlyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 3,
    name: 'EN - 2 hours later',
    message: 'Tell me the weather in Hanoi 2 hours later from now',
    subIntent: 'CheckHourlyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 4,
    name: 'EN - after 2 oclock',
    message: "Tell me the weather after 2 o'clock",
    subIntent: 'CheckHourlyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 5,
    name: 'EN - before 11pm',
    message: 'hanoi weather before 11pm',
    subIntent: 'CheckHourlyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 6,
    name: 'EN - tonight',
    message: "tell me tonight's weather",
    subIntent: 'CheckHourlyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 7,
    name: 'EN - tomorrow morning',
    message: "tell me tomorrow morning's weather",
    subIntent: 'CheckHourlyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 8,
    name: 'KO - tomorrow morning',
    message: '내일 오전 날씨',
    subIntent: 'CheckHourlyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 9,
    name: 'KO - tomorrow afternoon',
    message: '내일 오후 날씨',
    subIntent: 'CheckHourlyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
  {
    id: 10,
    name: 'KR+EN - tomorrow daytime',
    message: "tell me tomorrow 낮's weather",
    subIntent: 'CheckHourlyForecast',
    mainIntent: 'Weather',
    agentType: 'DailyInfoAgent',
  },
];
