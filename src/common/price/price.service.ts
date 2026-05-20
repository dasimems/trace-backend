import { Injectable } from '@nestjs/common';
import { Price } from './price.dto';
import * as currencies from 'world-currencies';
import { getAllCountries } from 'country-locale-map';

const allCountries = getAllCountries();

@Injectable()
export class PriceService {
  constructor() {}

  private getCurrencyDetails(currencyCode = 'NGN') {
    const currencyDetails = currencies[currencyCode] || {
      name: 'Nigerian Naira',
      iso: { code: 'NGN', number: '566' },
      units: {
        major: { name: 'Naira', symbol: '₦' },
        minor: { name: 'Kobo', symbol: '', majorValue: 0.01 },
      },
      banknotes: {
        frequent: ['₦5', '₦10', '₦20', '₦50', '₦100', '₦200', '₦500', '₦1000'],
        rare: [],
      },
      coins: { frequent: ['₦1', '₦2', '50'], rare: [] },
    };

    return currencyDetails;
  }

  convertToMajorUnit(smallestUnit = 0, currencyCode = 'NGN') {
    const currencyDetails = this.getCurrencyDetails(currencyCode);
    const majorValue = currencyDetails?.units?.minor?.majorValue ?? 1;
    return smallestUnit * majorValue;
  }

  convertToSmallestUnit(amount: number, currencyCode = 'NGN') {
    const currencyDetails = this.getCurrencyDetails(currencyCode);
    const majorValue = currencyDetails?.units?.minor?.majorValue ?? 1;
    return amount / majorValue;
  }

  // Compact metadata describing a currency. Use when emitting payloads where
  // values are kept in the smallest unit (e.g. LLM snapshots) and the reader
  // needs context to interpret them.
  getCurrencyMeta(currencyCode = 'NGN') {
    const currencyDetails = this.getCurrencyDetails(currencyCode);
    const majorValue = currencyDetails?.units?.minor?.majorValue ?? 1;
    return {
      code: currencyDetails?.iso?.code ?? currencyCode,
      symbol: currencyDetails?.units?.major?.symbol ?? '',
      majorName: currencyDetails?.units?.major?.name ?? '',
      minorName: currencyDetails?.units?.minor?.name ?? '',
      minorPerMajor: majorValue === 0 ? 1 : Math.round(1 / majorValue),
    };
  }

  constructPriceResponse(smallestUnit = 0, currencyCode = 'NGN'): Price {
    const currencyDetails = this.getCurrencyDetails(currencyCode);

    const countryDetails = allCountries.find(
      (country) => country?.currency === currencyCode,
    );
    const locale =
      countryDetails?.default_locale?.replaceAll('_', '-') || 'en-NG';
    const minorPerMajor = 1 / currencyDetails.units.minor.majorValue;
    const currencyFormat = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyDetails?.iso?.code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      numberFormat = new Intl.NumberFormat(locale, {
        style: 'decimal',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const number = this.convertToMajorUnit(smallestUnit, currencyCode);
    return {
      amount: number,
      currency: {
        code: currencyDetails?.iso?.code,
        symbol: currencyDetails?.units?.major?.symbol,
        name: currencyDetails?.units?.major?.name,
        locale,
      },
      formatted: {
        withCurrency: currencyFormat.format(number),
        withoutCurrency: numberFormat.format(number),
      },
      parts: {
        whole: Math.trunc(number),
        subUnit: Math.round(
          Math.abs((number - Math.trunc(number)) * minorPerMajor),
        ),
        smallestUnit: Math.round(number * minorPerMajor),
      },
    };
  }
}
