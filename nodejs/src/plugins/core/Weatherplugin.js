/**
 * Weather Plugin
 * Provides weather information using wttr.in API
 * Supports current weather, forecasts, and location-based queries
 */

const https = require('https');
const logger = require('../../utils/logger');

class WeatherPlugin {
    constructor() {
        this.name = 'weather';
        this.version = '1.0.0';
        this.description = 'Get weather information for any location';
        this.author = 'WhatsApp AutoGen Bot';
        this.type = 'tool';

        this.defaultConfig = {
            apiEndpoint: 'wttr.in',
            timeout: 10000,
            defaultFormat: 'json',
            units: 'metric', // metric or imperial
            language: 'en'
        };

        this.tools = {
            'get_weather': {
                description: 'Get current weather information for a location',
                category: 'information',
                parameters: {
                    location: {
                        type: 'string',
                        description: 'City name, address, or coordinates',
                        required: true
                    },
                    units: {
                        type: 'string',
                        description: 'Temperature units: metric (C) or imperial (F)',
                        required: false,
                        default: 'metric'
                    },
                    includeForecast: {
                        type: 'boolean',
                        description: 'Include forecast for next days',
                        required: false,
                        default: false
                    }
                },
                examples: [
                    { location: 'New York' },
                    { location: 'London', units: 'metric' },
                    { location: 'Tokyo', includeForecast: true }
                ],
                execute: this.getWeather.bind(this)
            },
            'get_forecast': {
                description: 'Get weather forecast for upcoming days',
                category: 'information',
                parameters: {
                    location: {
                        type: 'string',
                        description: 'City name, address, or coordinates',
                        required: true
                    },
                    days: {
                        type: 'number',
                        description: 'Number of days (1-7)',
                        required: false,
                        default: 3
                    },
                    units: {
                        type: 'string',
                        description: 'Temperature units: metric or imperial',
                        required: false,
                        default: 'metric'
                    }
                },
                examples: [
                    { location: 'Paris', days: 3 },
                    { location: 'San Francisco', days: 5, units: 'imperial' }
                ],
                execute: this.getForecast.bind(this)
            }
        };
    }

    async initialize(config) {
        this.config = { ...this.defaultConfig, ...config };
        logger.info('🌤️ Weather Plugin initialized');
    }

    async getWeather(parameters) {
        const { location, units = this.config.units, includeForecast = false } = parameters;

        if (!location || typeof location !== 'string' || location.trim().length === 0) {
            throw new Error('Location is required');
        }

        try {
            logger.debug(`🌤️ Getting weather for: ${location}`);

            const weatherData = await this.fetchWeatherData(location, units);

            const result = {
                location: weatherData.nearest_area?.[0]?.areaName?.[0]?.value || location,
                region: weatherData.nearest_area?.[0]?.region?.[0]?.value || '',
                country: weatherData.nearest_area?.[0]?.country?.[0]?.value || '',
                current: this.parseCurrentWeather(weatherData.current_condition?.[0], units),
                units: units === 'metric' ? '°C' : '°F',
                success: true
            };

            if (includeForecast && weatherData.weather) {
                result.forecast = weatherData.weather.slice(0, 3).map(day => this.parseForecastDay(day, units));
            }

            return result;

        } catch (error) {
            logger.error('❌ Weather fetch error:', error);
            throw new Error(`Failed to get weather: ${error.message}`);
        }
    }

    async getForecast(parameters) {
        const { location, days = 3, units = this.config.units } = parameters;

        if (!location || typeof location !== 'string' || location.trim().length === 0) {
            throw new Error('Location is required');
        }

        const numDays = Math.min(Math.max(days, 1), 7);

        try {
            logger.debug(`📅 Getting ${numDays}-day forecast for: ${location}`);

            const weatherData = await this.fetchWeatherData(location, units);

            const result = {
                location: weatherData.nearest_area?.[0]?.areaName?.[0]?.value || location,
                region: weatherData.nearest_area?.[0]?.region?.[0]?.value || '',
                country: weatherData.nearest_area?.[0]?.country?.[0]?.value || '',
                forecast: weatherData.weather?.slice(0, numDays).map(day => this.parseForecastDay(day, units)) || [],
                units: units === 'metric' ? '°C' : '°F',
                days: numDays,
                success: true
            };

            return result;

        } catch (error) {
            logger.error('❌ Forecast fetch error:', error);
            throw new Error(`Failed to get forecast: ${error.message}`);
        }
    }

    async fetchWeatherData(location, units) {
        return new Promise((resolve, reject) => {
            const encodedLocation = encodeURIComponent(location);
            const unitParam = units === 'imperial' ? '?u' : '?m';
            const url = `https://${this.config.apiEndpoint}/${encodedLocation}${unitParam}&format=j1`;

            const timeout = setTimeout(() => {
                reject(new Error('Weather request timeout'));
            }, this.config.timeout);

            https.get(url, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    clearTimeout(timeout);

                    if (res.statusCode !== 200) {
                        reject(new Error(`Weather API returned status ${res.statusCode}`));
                        return;
                    }

                    try {
                        const jsonData = JSON.parse(data);

                        if (!jsonData.current_condition) {
                            reject(new Error('Invalid weather data received'));
                            return;
                        }

                        resolve(jsonData);

                    } catch (error) {
                        reject(new Error(`Failed to parse weather data: ${error.message}`));
                    }
                });

            }).on('error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Weather request failed: ${error.message}`));
            });
        });
    }

    parseCurrentWeather(condition, units) {
        if (!condition) {
            return null;
        }

        return {
            temperature: parseInt(condition.temp_C || condition.temp_F),
            feelsLike: parseInt(condition.FeelsLikeC || condition.FeelsLikeF),
            description: condition.weatherDesc?.[0]?.value || 'Unknown',
            humidity: parseInt(condition.humidity),
            windSpeed: parseInt(condition.windspeedKmph || condition.windspeedMiles),
            windDirection: condition.winddir16Point || '',
            pressure: parseInt(condition.pressure),
            visibility: parseInt(condition.visibility || condition.visibilityMiles),
            uvIndex: parseInt(condition.uvIndex || 0),
            cloudCover: parseInt(condition.cloudcover || 0),
            precipMM: parseFloat(condition.precipMM || 0),
            observationTime: condition.observation_time || ''
        };
    }

    parseForecastDay(day, units) {
        if (!day) {
            return null;
        }

        return {
            date: day.date,
            maxTemp: parseInt(day.maxtempC || day.maxtempF),
            minTemp: parseInt(day.mintempC || day.mintempF),
            avgTemp: parseInt(day.avgtempC || day.avgtempF),
            totalSnow: parseFloat(day.totalSnow_cm || 0),
            sunHour: parseFloat(day.sunHour || 0),
            uvIndex: parseInt(day.uvIndex || 0),
            description: day.hourly?.[0]?.weatherDesc?.[0]?.value || 'Unknown',
            chanceOfRain: parseInt(day.hourly?.[4]?.chanceofrain || 0),
            chanceOfSnow: parseInt(day.hourly?.[4]?.chanceofsnow || 0)
        };
    }

    formatWeatherResponse(weatherData) {
        const current = weatherData.current;
        let response = `Weather for ${weatherData.location}`;

        if (weatherData.region) {
            response += `, ${weatherData.region}`;
        }
        if (weatherData.country) {
            response += `, ${weatherData.country}`;
        }

        response += `\n\n`;
        response += `🌡️ Temperature: ${current.temperature}${weatherData.units} (Feels like ${current.feelsLike}${weatherData.units})\n`;
        response += `☁️ Conditions: ${current.description}\n`;
        response += `💧 Humidity: ${current.humidity}%\n`;
        response += `💨 Wind: ${current.windSpeed} km/h ${current.windDirection}\n`;
        response += `👁️ Visibility: ${current.visibility} km\n`;

        if (weatherData.forecast && weatherData.forecast.length > 0) {
            response += `\n📅 Forecast:\n`;
            weatherData.forecast.forEach(day => {
                response += `\n${day.date}: ${day.minTemp}${weatherData.units} - ${day.maxTemp}${weatherData.units}`;
                response += ` | ${day.description}`;
                if (day.chanceOfRain > 30) {
                    response += ` | 🌧️ ${day.chanceOfRain}% rain`;
                }
            });
        }

        return response;
    }

    async cleanup() {
        logger.info('🌤️ Weather Plugin cleaned up');
    }
}

module.exports = WeatherPlugin;