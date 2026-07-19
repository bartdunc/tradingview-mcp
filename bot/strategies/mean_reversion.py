"""Mean reversion strategy for range-bound index ETFs (SPY, QQQ).

Fades moves more than `std_dev_threshold` standard deviations from the
rolling mean, expecting a revert; exits once price is back near the mean.
"""
import pandas as pd


def generate_signal(df, position, params):
    lookback = params.get("lookback", 20)
    threshold = params.get("std_dev_threshold", 1.5)
    exit_threshold = params.get("exit_std_dev", 0.25)

    if len(df) < lookback + 1:
        return None

    closes = df["close"]
    mean = closes.rolling(lookback).mean().iloc[-1]
    stdev = closes.rolling(lookback).std().iloc[-1]

    if pd.isna(stdev) or stdev == 0:
        return None

    price = closes.iloc[-1]
    z_score = (price - mean) / stdev

    if position is None:
        if z_score <= -threshold:
            return "long"
        if z_score >= threshold:
            return "short"
        return None

    if abs(z_score) <= exit_threshold:
        return "exit"
    return None
