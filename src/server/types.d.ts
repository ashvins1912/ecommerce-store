declare module 'wink-sentiment' {
  interface WinkSentimentResult {
    score: number;
    normalizedScore: number;
    tokenizedPhrase: Array<{ value: string; tag: string; score?: number }>;
  }
  export default function sentiment(phrase: string): WinkSentimentResult;
}
