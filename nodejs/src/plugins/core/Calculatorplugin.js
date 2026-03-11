/**
 * Calculator Plugin
 * Provides mathematical calculation capabilities
 * Supports basic arithmetic, advanced math, and expression evaluation
 */

const logger = require('../../utils/logger');

class CalculatorPlugin {
    constructor() {
        this.name = 'calculator';
        this.version = '1.0.0';
        this.description = 'Perform mathematical calculations and evaluate expressions';
        this.author = 'WhatsApp AutoGen Bot';
        this.type = 'tool';

        this.defaultConfig = {
            precision: 10,
            allowComplexExpressions: true,
            maxExpressionLength: 1000
        };

        this.tools = {
            'calculate': {
                description: 'Evaluate mathematical expressions and perform calculations',
                category: 'math',
                parameters: {
                    expression: {
                        type: 'string',
                        description: 'Mathematical expression to evaluate',
                        required: true
                    },
                    precision: {
                        type: 'number',
                        description: 'Number of decimal places (default: 10)',
                        required: false,
                        default: 10
                    }
                },
                examples: [
                    { expression: '2 + 2' },
                    { expression: 'sqrt(16) + 5^2' },
                    { expression: 'sin(45) * cos(45)' },
                    { expression: '(100 - 25) * 0.15' }
                ],
                execute: this.calculate.bind(this)
            },
            'convert_units': {
                description: 'Convert between different units',
                category: 'math',
                parameters: {
                    value: {
                        type: 'number',
                        description: 'Value to convert',
                        required: true
                    },
                    from: {
                        type: 'string',
                        description: 'Source unit',
                        required: true
                    },
                    to: {
                        type: 'string',
                        description: 'Target unit',
                        required: true
                    }
                },
                examples: [
                    { value: 100, from: 'km', to: 'miles' },
                    { value: 32, from: 'fahrenheit', to: 'celsius' },
                    { value: 1, from: 'hour', to: 'seconds' }
                ],
                execute: this.convertUnits.bind(this)
            }
        };

        // Conversion rates
        this.conversions = {
            // Length
            length: {
                meter: 1,
                kilometer: 0.001,
                km: 0.001,
                centimeter: 100,
                cm: 100,
                millimeter: 1000,
                mm: 1000,
                mile: 0.000621371,
                miles: 0.000621371,
                yard: 1.09361,
                yards: 1.09361,
                foot: 3.28084,
                feet: 3.28084,
                ft: 3.28084,
                inch: 39.3701,
                inches: 39.3701,
                in: 39.3701
            },
            // Weight
            weight: {
                kilogram: 1,
                kg: 1,
                gram: 1000,
                g: 1000,
                milligram: 1000000,
                mg: 1000000,
                pound: 2.20462,
                pounds: 2.20462,
                lb: 2.20462,
                ounce: 35.274,
                ounces: 35.274,
                oz: 35.274
            },
            // Temperature (special handling)
            temperature: {
                celsius: 'C',
                fahrenheit: 'F',
                kelvin: 'K'
            },
            // Time
            time: {
                second: 1,
                seconds: 1,
                sec: 1,
                minute: 1 / 60,
                minutes: 1 / 60,
                min: 1 / 60,
                hour: 1 / 3600,
                hours: 1 / 3600,
                hr: 1 / 3600,
                day: 1 / 86400,
                days: 1 / 86400,
                week: 1 / 604800,
                weeks: 1 / 604800
            }
        };
    }

    async initialize(config) {
        this.config = { ...this.defaultConfig, ...config };
        logger.info('🔢 Calculator Plugin initialized');
    }

    async calculate(parameters) {
        const { expression, precision = this.config.precision } = parameters;

        if (!expression || typeof expression !== 'string') {
            throw new Error('Expression is required');
        }

        if (expression.length > this.config.maxExpressionLength) {
            throw new Error('Expression too long');
        }

        try {
            // Sanitize expression
            const sanitized = this.sanitizeExpression(expression);

            // Evaluate expression
            const result = this.evaluateExpression(sanitized);

            // Format result
            const formatted = this.formatNumber(result, precision);

            logger.debug(`🔢 Calculated: ${expression} = ${formatted}`);

            return {
                expression,
                result: formatted,
                rawResult: result,
                success: true
            };

        } catch (error) {
            throw new Error(`Calculation error: ${error.message}`);
        }
    }

    sanitizeExpression(expr) {
        // Remove potentially dangerous characters
        let sanitized = expr.replace(/[^0-9+\-*/.()^%\s,a-z]/gi, '');

        // Replace common math functions
        const replacements = {
            'sqrt': 'Math.sqrt',
            'sin': 'Math.sin',
            'cos': 'Math.cos',
            'tan': 'Math.tan',
            'asin': 'Math.asin',
            'acos': 'Math.acos',
            'atan': 'Math.atan',
            'abs': 'Math.abs',
            'floor': 'Math.floor',
            'ceil': 'Math.ceil',
            'round': 'Math.round',
            'log': 'Math.log',
            'ln': 'Math.log',
            'log10': 'Math.log10',
            'exp': 'Math.exp',
            'pi': 'Math.PI',
            'e': 'Math.E'
        };

        for (const [key, value] of Object.entries(replacements)) {
            const regex = new RegExp(`\\b${key}\\b`, 'gi');
            sanitized = sanitized.replace(regex, value);
        }

        // Replace ^ with **
        sanitized = sanitized.replace(/\^/g, '**');

        return sanitized;
    }

    evaluateExpression(expr) {
        try {
            // Use Function constructor for safe evaluation
            // Note: In production, consider using a proper math parser library
            const result = Function(`"use strict"; return (${expr})`)();

            if (typeof result !== 'number' || !isFinite(result)) {
                throw new Error('Invalid result');
            }

            return result;

        } catch (error) {
            throw new Error(`Invalid expression: ${error.message}`);
        }
    }

    formatNumber(num, precision) {
        if (Number.isInteger(num)) {
            return num;
        }

        const factor = Math.pow(10, precision);
        return Math.round(num * factor) / factor;
    }

    async convertUnits(parameters) {
        const { value, from, to } = parameters;

        if (typeof value !== 'number') {
            throw new Error('Value must be a number');
        }

        if (!from || !to) {
            throw new Error('Both "from" and "to" units are required');
        }

        const fromLower = from.toLowerCase();
        const toLower = to.toLowerCase();

        try {
            // Find conversion category
            let result;

            // Temperature conversion (special case)
            if (this.conversions.temperature[fromLower] && this.conversions.temperature[toLower]) {
                result = this.convertTemperature(value, fromLower, toLower);
            } else {
                // Find which category contains both units
                let category = null;
                for (const [cat, units] of Object.entries(this.conversions)) {
                    if (cat === 'temperature') continue;
                    if (units[fromLower] && units[toLower]) {
                        category = units;
                        break;
                    }
                }

                if (!category) {
                    throw new Error(`Cannot convert from ${from} to ${to}`);
                }

                // Convert: value -> base unit -> target unit
                const baseValue = value / category[fromLower];
                result = baseValue * category[toLower];
            }

            const formatted = this.formatNumber(result, 6);

            logger.debug(`🔄 Converted: ${value} ${from} = ${formatted} ${to}`);

            return {
                value,
                from,
                to,
                result: formatted,
                success: true
            };

        } catch (error) {
            throw new Error(`Conversion error: ${error.message}`);
        }
    }

    convertTemperature(value, from, to) {
        // Convert to Celsius first
        let celsius;

        switch (from) {
            case 'celsius':
                celsius = value;
                break;
            case 'fahrenheit':
                celsius = (value - 32) * 5 / 9;
                break;
            case 'kelvin':
                celsius = value - 273.15;
                break;
            default:
                throw new Error(`Unknown temperature unit: ${from}`);
        }

        // Convert from Celsius to target
        switch (to) {
            case 'celsius':
                return celsius;
            case 'fahrenheit':
                return celsius * 9 / 5 + 32;
            case 'kelvin':
                return celsius + 273.15;
            default:
                throw new Error(`Unknown temperature unit: ${to}`);
        }
    }

    async cleanup() {
        logger.info('🔢 Calculator Plugin cleaned up');
    }
}

module.exports = CalculatorPlugin;