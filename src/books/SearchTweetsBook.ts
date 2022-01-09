import { Collection } from '../util';
import { CustomError } from '../errors';
import { RequestData } from '../structures';
import { BaseRangeBook } from './BaseRangeBook';
import type { Client } from '../client';
import type { Tweet } from '../structures';
import type { SearchTweetsBookOptions } from '../typings';
import type { GETTweetsSearchRecentQuery, GETTweetsSearchRecentResponse, Snowflake } from 'twitter-types';

/**
 * A class for fetching tweets using search query
 */
export class SearchTweetsBook extends BaseRangeBook {
  /**
   * The query for searching tweets
   */
  query: string;

  /**
   * @param client The logged in {@link Client} instance
   * @param options The options to initialize the search tweets book with
   */
  constructor(client: Client, options: SearchTweetsBookOptions) {
    super(client, options);
    this.query = options.query;
  }

  /**
   * Fetches the next page of the book if there is one.
   * @returns A {@link Collection} of {@link Tweet} objects matching the search query
   */
  async fetchNextPage(): Promise<Collection<Snowflake, Tweet>> {
    if (!this._hasMadeInitialRequest) {
      this._hasMadeInitialRequest = true;
      return this.#fetchPages();
    }
    if (!this._nextToken) throw new CustomError('PAGINATED_RESPONSE_TAIL_REACHED');
    return this.#fetchPages(this._nextToken);
  }

  // #### 🚧 PRIVATE METHODS 🚧 ####

  async #fetchPages(token?: string): Promise<Collection<Snowflake, Tweet>> {
    const tweetsCollection = new Collection<Snowflake, Tweet>();
    const queryParameters = this.client.options.queryParameters;
    const query: GETTweetsSearchRecentQuery = {
      expansions: queryParameters?.tweetExpansions,
      'tweet.fields': queryParameters?.tweetFields,
      'user.fields': queryParameters?.userFields,
      'media.fields': queryParameters?.mediaFields,
      'place.fields': queryParameters?.placeFields,
      'poll.fields': queryParameters?.pollFields,
      query: this.query,
      next_token: token,
    };
    if (this.afterTweetId) query.since_id = this.afterTweetId;
    if (this.beforeTweetId) query.until_id = this.beforeTweetId;
    if (this.maxResultsPerPage) query.max_results = this.maxResultsPerPage;
    if (this.startTimestamp) query.start_time = new Date(this.startTimestamp).toISOString();
    if (this.endTimestamp) query.end_time = new Date(this.endTimestamp).toISOString();
    const requestData = new RequestData({ query });
    const data: GETTweetsSearchRecentResponse = await this.client._api.tweets.search.recent.get(requestData);
    this._nextToken = data.meta.next_token;
    this.hasMore = data.meta.next_token ? true : false;
    if (data.meta.result_count === 0) return tweetsCollection;
    const rawTweets = data.data;
    const rawIncludes = data.includes;
    for (const rawTweet of rawTweets) {
      const tweet = this.client.tweets._add(rawTweet.id, { data: rawTweet, includes: rawIncludes });
      tweetsCollection.set(tweet.id, tweet);
    }
    return tweetsCollection;
  }
}
