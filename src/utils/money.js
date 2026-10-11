import { MONEY } from '../constants/deal.js';

/**
 * Round a monetary amount to the configured number of decimals using a
 * half-up strategy that avoids binary floating point artefacts.
 *
 * @param {number} value
 * @param {number} [decimals]
 * @returns {number}
 */
export function roundMoney(value, decimals = MONEY.decimals) {
  const factor = 10 ** decimals;
  // `+ Number.EPSILON` compensates for values such as 1.005 which are stored
  // internally as 1.00499999999999989.
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

/**
 * Compute expected revenue from a deal value and a win probability.
 *
 * The computation is performed on integer cents so that the result is exact and
 * reproducible regardless of platform floating point behaviour.
 *
 * @param {number} dealValue
 * @param {number} probability 0 - 100
 * @returns {number}
 */
export function calculateExpectedRevenue(dealValue, probability) {
  const cents = Math.round((Number(dealValue) + Number.EPSILON) * 100);
  const weightedCents = Math.round((cents * Number(probability)) / 100);
  return weightedCents / 100;
}

/**
 * Sum an array of monetary amounts with consistent rounding.
 */
export function sumMoney(values) {
  const cents = values.reduce((acc, value) => acc + Math.round((Number(value) + Number.EPSILON) * 100), 0);
  return cents / 100;
}

/**
 * Currency metadata attached to API responses so that consumers know how to
 * interpret monetary figures.
 */
export const moneyMeta = () => ({ currency: MONEY.currency, decimals: MONEY.decimals });