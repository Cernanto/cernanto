# Open-Meteo

Given a place as latitude and longitude, answer tomorrow's forecast
for it from Open-Meteo's free forecast, which needs no account and
whose API is documented at
https://raw.githubusercontent.com/open-meteo/open-meteo/main/openapi/forecast.yml:
the highest and the lowest temperature in degrees Celsius, the chance
of rain as a percentage, the highest reached at any hour of the day,
and one word for the sky (clear, cloudy, rain
or snow), chosen with cernanto/decision, with the date the forecast is for.

Uses:

- openapi:https://raw.githubusercontent.com/open-meteo/open-meteo/main/openapi/forecast.yml
- cernanto/decision

## License

Copyright: 2026 Cernanto

License: Apache-2.0
