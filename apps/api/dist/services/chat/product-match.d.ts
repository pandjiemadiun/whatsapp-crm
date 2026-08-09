export declare const PRODUCT_MATCH_EXACT_THRESHOLD = 4;
export declare const PRODUCT_FUZZY_MAX_DISTANCE = 1;
export declare const PRODUCT_FUZZY_TOKEN_RATIO = 0.9;
export declare function levenshtein(a: string, b: string): number;
export declare function tokenizeText(text: string): string[];
export declare function productNameExact(query: string, name: string): boolean;
export declare function productNameStrongFuzzy(query: string, name: string): boolean;
/**
 * Decision the single-match branch of tryProduct uses, exported so the
 * acceptance tests can assert the exact gate without touching tryProduct's
 * private/DB-coupled body.
 *   query        normalized message text
 *   name         candidate product name
 *   resultCount  number of products returned by search (1 = single candidate)
 */
export declare function shouldAnswerSingleProduct(query: string, name: string, resultCount: number): boolean;
declare const _default: {
    productNameExact: typeof productNameExact;
    productNameStrongFuzzy: typeof productNameStrongFuzzy;
    shouldAnswerSingleProduct: typeof shouldAnswerSingleProduct;
    levenshtein: typeof levenshtein;
    tokenizeText: typeof tokenizeText;
};
export default _default;
//# sourceMappingURL=product-match.d.ts.map