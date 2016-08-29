import sqlTokenTypes from "xr/sqlFormatter/sqlTokenTypes";

export default class SqlTokenizer {
    /**
     * @param {Object} cfg
     *  @param {Array} cfg.reservedWords Reserved words in SQL
     *  @param {Array} cfg.reservedToplevelWords Words that are set to new line and on first indent level
     *  @param {Array} cfg.reservedNewlineWords Words that are set to newline
     *  @param {Array} cfg.functionWords Words that are treated as functions
     */
    constructor({reservedWords, reservedToplevelWords, reservedNewlineWords, functionWords}) {
        const boundaries = "(,|;|\\:|\\)|\\(|\\.|\\=|\\<|\\>|\\+|\\-|\\*|\\/|\\!|\\^|%|\\||&|#)";

        this.WHITESPACE_REGEX = /^(\s+)/;
        this.LINE_COMMENT_REGEX = /^((?:#|--).*?(?:\n|$))/;
        this.BLOCK_COMMENT_REGEX = /^(\/\*[^]*?(?:\*\/|$))/;
        this.NUMBER_REGEX = new RegExp(`^((-\s*)?[0-9]+(\\.[0-9]+)?|0x[0-9a-fA-F]+|0b[01]+)($|\\s|"'\`|${boundaries})`);
        this.BOUNDARY_REGEX = new RegExp(`^(${boundaries})`);
        this.FUNCTION_REGEX = new RegExp(`^(${functionWords.join("|")})\\(`, "i");

        this.RESERVED_TOPLEVEL_REGEX = new RegExp(`^(${reservedToplevelWords.join("|")})($|\\s|${boundaries})`, "i");
        this.RESERVED_NEWLINE_REGEX = new RegExp(`^(${reservedNewlineWords.join("|")})($|\\s|${boundaries})`, "i");
        this.RESERVED_REGEX = new RegExp(`^(${reservedWords.join("|")})($|\\s|${boundaries})`, "i");

        this.NON_RESERVED_WORD_REGEX = new RegExp(`^(.*?)($|\\s|["'\`]|${boundaries})`);

        // This checks for the following patterns:
        // 1. backtick quoted string using `` to escape
        // 2. square bracket quoted string (SQL Server) using ]] to escape
        // 3. double quoted string using "" or \" to escape
        // 4. single quoted string using "" or \" to escape
        this.STRING_REGEX = new RegExp(
            "^(((`[^`]*($|`))+)|" +
            "((\\[[^\\]]*($|\\]))(\\][^\\]]*($|\\]))*)|" +
            "((\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*(\"|$))+)|" +
            "(('[^'\\\\]*(?:\\\\.[^'\\\\]*)*('|$))+))"
        );
    }

    /**
     * Takes a SQL string and breaks it into tokens.
     * Each token is an object with type and value.
     *
     * @param {String} input The SQL string
     * @return {Object[]} tokens An array of tokens.
     *  @return {String} token.type
     *  @return {String} token.value
     */
    tokenize(input) {
        const tokens = [];
        let token;

        // Keep processing the string until it is empty
        while (input.length) {
            // Get the next token and the token type
            token = this.getNextToken(input, token);
            // Advance the string
            input = input.substring(token.value.length);

            tokens.push(token);
        }
        return tokens;
    }

    getNextToken(input, previousToken) {
        return this.getWhitespaceToken(input) ||
            this.getCommentToken(input) ||
            this.getQuotedStringToken(input) ||
            this.getVariableToken(input) ||
            this.getNumberToken(input) ||
            this.getBoundaryCharacterToken(input) ||
            this.getReservedWordToken(input, previousToken) ||
            this.getFunctionWordToken(input) ||
            this.getNonReservedWordToken(input);
    }

    getWhitespaceToken(input) {
        return this.getTokenOnFirstMatch({
            input,
            type: sqlTokenTypes.WHITESPACE,
            regex: this.WHITESPACE_REGEX
        });
    }

    getCommentToken(input) {
        return this.getLineCommentToken(input) || this.getBlockCommentToken(input);
    }

    getLineCommentToken(input) {
        return this.getTokenOnFirstMatch({
            input,
            type: sqlTokenTypes.COMMENT,
            regex: this.LINE_COMMENT_REGEX
        });
    }

    getBlockCommentToken(input) {
        return this.getTokenOnFirstMatch({
            input,
            type: sqlTokenTypes.BLOCK_COMMENT,
            regex: this.BLOCK_COMMENT_REGEX
        });
    }

    getQuotedStringToken(input) {
        const firstChar = input.charAt(0);

        if (firstChar === "\"" || firstChar === "'" || firstChar === "`" || firstChar === "[") {
            return {
                type: (firstChar === "`" || firstChar === "[") ? sqlTokenTypes.BACKTICK_QUOTE : sqlTokenTypes.QUOTE,
                value: this.getQuotedString(input)
            };
        }
    }

    getVariableToken(input) {
        if ((input.charAt(0) === "@" || input.charAt(0) === ":") && input.charAt(1)) {
            // Quoted variable name
            if (input.charAt(1) === "\"" || input.charAt(1) === "'" || input.charAt(1) === "`") {
                return {
                    type: sqlTokenTypes.VARIABLE,
                    value: input.charAt(0) + this.getQuotedString(input.substring(1))
                };
            }
            // Non-quoted variable name
            else {
                return this.getTokenOnFirstMatch({
                    input,
                    type: sqlTokenTypes.VARIABLE,
                    regex: new RegExp(`^(${input.charAt(0)}[a-zA-Z0-9\\._\\$]+)`)
                });
            }
        }
    }

    // Decimal, binary, or hex numbers
    getNumberToken(input) {
        return this.getTokenOnFirstMatch({
            input,
            type: sqlTokenTypes.NUMBER,
            regex: this.NUMBER_REGEX
        });
    }

    // Punctuation and symbols
    getBoundaryCharacterToken(input) {
        return this.getTokenOnFirstMatch({
            input,
            type: sqlTokenTypes.BOUNDARY,
            regex: this.BOUNDARY_REGEX
        });
    }

    getReservedWordToken(input, previousToken) {
        // A reserved word cannot be preceded by a "."
        // this makes it so in "mytable.from", "from" is not considered a reserved word
        if (previousToken && previousToken.value && previousToken.value === ".") {
            return;
        }
        const toplevelReservedWordToken = this.getTokenOnFirstMatch({
            input,
            type: sqlTokenTypes.RESERVED_TOPLEVEL,
            regex: this.RESERVED_TOPLEVEL_REGEX
        });

        if (toplevelReservedWordToken) {
            return toplevelReservedWordToken;
        }

        const newlineReservedWordToken = this.getTokenOnFirstMatch({
            input,
            type: sqlTokenTypes.RESERVED_NEWLINE,
            regex: this.RESERVED_NEWLINE_REGEX
        });

        if (newlineReservedWordToken) {
            return newlineReservedWordToken;
        }

        return this.getTokenOnFirstMatch({
            input,
            type: sqlTokenTypes.RESERVED,
            regex: this.RESERVED_REGEX
        });
    }

    getFunctionWordToken(input) {
        // A function must be suceeded by "("
        // this makes it so "count(" is considered a function, but "count" alone is not
        return this.getTokenOnFirstMatch({
            input,
            type: sqlTokenTypes.RESERVED,
            regex: this.FUNCTION_REGEX
        });
    }

    getNonReservedWordToken(input) {
        return this.getTokenOnFirstMatch({
            input,
            type: sqlTokenTypes.WORD,
            regex: this.NON_RESERVED_WORD_REGEX
        });
    }

    getTokenOnFirstMatch({input, type, regex}) {
        const matches = input.match(regex);

        if (matches) {
            return {type, value: matches[1]};
        }
    }

    getQuotedString(input) {
        const matches = input.match(this.STRING_REGEX);

        if (matches) {
            return matches[1];
        }
    }
}