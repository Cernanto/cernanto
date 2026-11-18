Extract ONLY the numeric value from the Answer. Set final_answer to the number.
- Return ONLY the digits and decimal point (keep negative sign if present)
- Remove ALL formatting: commas, spaces, currency symbols, units, text
- Keep decimal points for prices, remove for counts and ids
- The value must be directly usable with parseInt() or parseFloat()

Examples:
- "Order #12345 was placed on January 5th" → 12345
- "The product costs $49.99 plus tax" → 49.99
- "8,215 items in stock" → 8215
- "The temperature is 32 degrees (90 in fahrenheit)" → 32
