Extract the MOST MINIMAL form of the answer that directly addresses what was asked. When in doubt, return less rather than more. Set final_answer to the extracted string.

CORE PRINCIPLE: When asking for an identifier (version, number, name, code), return ONLY that identifier without descriptions, dates, or qualifiers.

EXTRACTION RULES BY TYPE:

TEXT VALUES:
- Remove redundant information but preserve essential meaning
- If already minimal (single word or phrase), return exactly as-is
- Remove introductory phrases like "The answer is", "It is", "This is"

BOOLEAN VALUES (Yes/No/True/False questions):
- Extract ONLY the boolean answer (Yes, No, True, False)
- Remove ALL explanations, justifications, or additional context
- Convert implied answers to explicit Yes/No

LISTS:
- Remove ALL introductory phrases before lists
- Return ONLY the items themselves, not the preamble

NUMERIC VALUES (prices, quantities, counts, ids, measurements):
- Return ONLY the digits and decimal point (keep negative sign if present)
- Remove ALL formatting: commas, spaces, currency symbols, units, text
- Must be directly usable with parseInt() or parseFloat()

DATE/TIME VALUES:
- Return in a format that the JavaScript Date() constructor accepts
- Do NOT return relative dates like "tomorrow" or "next week"

ENTITY/SUBJECT REMOVAL:
- When asked "What is X?", remove "X is/are" from the beginning of the answer
- Exception: if asking "Who is THE [role]?" extract the name, not the description
- Pattern: "[Subject] is/are [definition]" → return only "[definition]"

CONTEXT REMOVAL:
- Extract only the core information that answers the question
- Remove temporal context like "since 2020", "has been"

PRESERVE EXACT WORDING:
- Some questions require the exact text to be preserved
- If asking "What is the user asking?" return their exact question

GENERAL RULES:
- Include ONLY what was specifically requested
- Remove ALL elaboration, descriptions, and supplementary information

Examples:
- Question: "What is the search query?" Answer: "Technology" → "Technology"
- Question: "Is it correct?" Answer: "Yes, this is the correct approach" → "Yes"
- Question: "List the items" Answer: "Here are the items: apple, banana, orange" → "apple, banana, orange"
- Question: "What is the order number?" Answer: "Order #12345 was placed on January 5th" → "12345"
- Question: "What is the price?" Answer: "The product costs $49.99 plus tax" → "49.99"
- Question: "When is the meeting?" Answer: "The meeting is scheduled for March 15, 2024 at 2:30 PM" → "2024-03-15T14:30:00"
- Question: "What is Python?" Answer: "Python is a high-level programming language" → "A high-level programming language"
- Question: "Who is the CEO?" Answer: "John Smith has been CEO since 2020" → "John Smith"
- Question: "What is the user asking?" Answer: "The user is asking 'Who is Alice?'" → "Who is Alice?"
