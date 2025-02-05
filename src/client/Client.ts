import { BaseClient, type ClientOptions } from './BaseClient';
import { RESTManager } from '../rest/RESTManager';
import { ClientEvents, Collection } from '../util';
import { CustomError, CustomTypeError } from '../errors';
import { UserManager, TweetManager, SpaceManager, ListManager, FilteredStreamRuleManager } from '../managers';
import {
	ClientCredentials,
	RequestData,
	ClientUser,
	MatchingRule,
	type ClientCredentialsInterface,
} from '../structures';
import type { Response } from 'undici';
import type {
	GETTweetsSampleStreamQuery,
	GETTweetsSampleStreamResponse,
	GETTweetsSearchStreamQuery,
	GETTweetsSearchStreamResponse,
	GETUsersMeQuery,
	GETUsersMeResponse,
} from 'twitter-types';
import { Readable } from 'node:stream';
import {
	BlockedUsersBook,
	type BlockedUsersBookOptions,
	ComposedTweetsBook,
	type ComposedTweetsBookOptions,
	FollowedListsBook,
	type FollowedListsBookOptions,
	LikedByUsersBook,
	type LikedByUsersBookOptions,
	UserMentioningTweetsBook,
	type UserMentioningTweetsBookOptions,
	LikedTweetsBook,
	type LikedTweetsBookOptions,
	ListFollowersBook,
	type ListFollowersBookOptions,
	ListMembersBook,
	type ListMembersBookOptions,
	ListTweetsBook,
	type ListTweetsBookOptions,
	MemberOfListsBook,
	type MemberOfListsBookOptions,
	MutedUsersBook,
	type MutedUsersBookOptions,
	OwnedListsBook,
	type OwnedListsBookOptions,
	PinnedListsBook,
	type PinnedListsBookOptions,
	RetweetedByUsersBook,
	type RetweetedByUsersBookOptions,
	TweetsCountBook,
	type TweetsCountBookOptions,
	UserFollowersBook,
	type UserFollowersBookOptions,
	UserFollowingsBook,
	type UserFollowingsBookOptions,
	SearchTweetsBook,
	type SearchTweetsBookOptions,
	SpaceTicketBuyersBook,
	type SpaceTicketBuyersBookOptions,
} from '../books';

/**
 * The core class that exposes all the functionalities available in twitter.js
 */
export class Client extends BaseClient {
	/**
	 * The time at which the client became `ready`
	 */
	readyAt: Date | null;

	/**
	 * The bearer token that was provided to the client during login
	 */
	token: string | null;

	/**
	 * The credentials that were provided to the client during login
	 *
	 * **Note**: This will be available only if the client was logged in using {@link Client.login}
	 */
	credentials: ClientCredentials | null;

	/**
	 * The twitter user this client represents
	 *
	 * **Note**: This will be available only if the client was logged in using {@link Client.login}
	 */
	me: ClientUser | null;

	/**
	 * The manager for twitter API requests made by the client
	 * @internal
	 */
	rest: RESTManager;

	/**
	 * The manager for {@link Tweet} objects
	 */
	tweets: TweetManager;

	/**
	 * The manager for {@link User} objects
	 */
	users: UserManager;

	/**
	 * The manager for {@link Space} objects
	 */
	spaces: SpaceManager;

	/**
	 * The manager for {@link List} objects
	 */
	lists: ListManager;

	/**
	 * The manager for {@link FilteredStreamRule} objects
	 */
	filteredStreamRules: FilteredStreamRuleManager;

	/**
	 * @param options The options to initialize the client with
	 */
	constructor(options?: ClientOptions) {
		super(options);

		Object.defineProperty(this, 'token', { writable: true, enumerable: false });
		this.token = null;

		Object.defineProperty(this, 'credentials', { writable: true, enumerable: false });
		this.credentials = null;

		this.me = null;
		this.readyAt = null;
		this.rest = new RESTManager(this);
		this.tweets = new TweetManager(this);
		this.users = new UserManager(this);
		this.spaces = new SpaceManager(this);
		this.lists = new ListManager(this);
		this.filteredStreamRules = new FilteredStreamRuleManager(this);
	}

	/**
	 * A getter that returns the `routeBuilder` method of {@link RESTManager}
	 * for making API requests
	 * @internal
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	get _api(): any {
		return this.rest.routeBuilder;
	}

	/**
	 * Sets the client ready to make bearer token authorized API requests.
	 * Emits a `ready` event on success.
	 * @param token The bearer token for the client
	 * @returns The provided bearer token
	 */
	async loginWithBearerToken(token: string): Promise<string> {
		if (typeof token !== 'string') {
			throw new CustomTypeError('INVALID_TYPE', 'token', 'string', false);
		}
		this.token = token;
		this.readyAt = new Date();

		this.emit(ClientEvents.READY, this);
		if (this.options.events.includes('FILTERED_TWEET_CREATE')) {
			this.#connectToFilteredStream();
		}
		if (this.options.events.includes('SAMPLED_TWEET_CREATE')) {
			this.#connectToSampledStream();
		}
		return this.token;
	}

	/**
	 * Sets the client ready to make both bearer token and user context authorized API requests.
	 * Emits a `ready` event on success.
	 * @param credentials The credentials for the client
	 * @returns The provided credentials
	 */
	async login(credentials: ClientCredentialsInterface): Promise<ClientCredentials> {
		if (typeof credentials !== 'object') {
			throw new CustomTypeError('INVALID_TYPE', 'credentials', 'object', true);
		}
		this.credentials = new ClientCredentials(credentials);
		this.token = this.credentials.bearerToken;
		this.readyAt = new Date();

		this.me = await this.#fetchClientUser();

		if (!this.me) throw new CustomError('USER_CONTEXT_LOGIN_ERROR');

		this.emit(ClientEvents.READY, this);
		if (this.options.events.includes('FILTERED_TWEET_CREATE')) {
			this.#connectToFilteredStream();
		}
		if (this.options.events.includes('SAMPLED_TWEET_CREATE')) {
			this.#connectToSampledStream();
		}
		return this.credentials;
	}

	/**
	 * Creates book for making paginated requests.
	 * @param bookName The name of the book to create
	 * @param options An object containing parameters to initialize the book with
	 * @returns An instance of the requested book class
	 * @example
	 * const user = await client.users.fetchByUsername('iShiibi');
	 * const composedTweetsBook = client.createBook('ComposedTweetsBook', { user, maxResultsPerPage: 5 });
	 * const userTweets = await composedTweetsBook.fetchNextPage();
	 */
	createBook<K extends CreateBookNameType>(bookName: K, options: CreateBookOptionType<K>): CreateBookReturnType<K> {
		// @ts-expect-error lol
		return new Books[bookName](this, options);
	}

	async #fetchClientUser(): Promise<ClientUser> {
		const queryParameters = this.options.queryParameters;
		const query: GETUsersMeQuery = {
			expansions: queryParameters?.userExpansions,
			'tweet.fields': queryParameters?.tweetFields,
			'user.fields': queryParameters?.userFields,
		};
		const requestData = new RequestData({ query, isUserContext: true });
		const data: GETUsersMeResponse = await this._api.users.me.get(requestData);
		return new ClientUser(this, data);
	}

	async #connectToFilteredStream(): Promise<void> {
		const queryParameters = this.options.queryParameters;
		const query: GETTweetsSearchStreamQuery = {
			expansions: queryParameters?.tweetExpansions,
			'media.fields': queryParameters?.mediaFields,
			'place.fields': queryParameters?.placeFields,
			'poll.fields': queryParameters?.pollFields,
			'tweet.fields': queryParameters?.tweetFields,
			'user.fields': queryParameters?.userFields,
		};
		const requestData = new RequestData({ query, isStreaming: true });
		const res: Response = await this._api.tweets.search.stream.get(requestData);
		if (!res.body) throw Error('No response body');
		const readableStream = Readable.from(res.body, { encoding: 'utf-8' });
		readableStream.on('data', chunk => {
			try {
				const rawData: GETTweetsSearchStreamResponse = JSON.parse(chunk);
				const tweet = this.tweets._add(rawData.data.id, rawData, false);
				const matchingRules = rawData.matching_rules.reduce((col, rule) => {
					col.set(rule.id, new MatchingRule(rule));
					return col;
				}, new Collection<string, MatchingRule>());
				this.emit(ClientEvents.FILTERED_TWEET_CREATE, tweet, matchingRules);
			} catch (error) {
				// TODO
			}
		});
	}

	async #connectToSampledStream(): Promise<void> {
		const queryParameters = this.options.queryParameters;
		const query: GETTweetsSampleStreamQuery = {
			expansions: queryParameters?.tweetExpansions,
			'media.fields': queryParameters?.mediaFields,
			'place.fields': queryParameters?.placeFields,
			'poll.fields': queryParameters?.pollFields,
			'tweet.fields': queryParameters?.tweetFields,
			'user.fields': queryParameters?.userFields,
		};
		const requestData = new RequestData({ query, isStreaming: true });
		const res: Response = await this._api.tweets.sample.stream.get(requestData);
		if (!res.body) throw Error('No response body');
		const readableStream = Readable.from(res.body, { encoding: 'utf-8' });
		readableStream.on('data', chunk => {
			try {
				const rawTweet: GETTweetsSampleStreamResponse = JSON.parse(chunk);
				const tweet = this.tweets._add(rawTweet.data.id, rawTweet, false);
				this.emit(ClientEvents.SAMPLED_TWEET_CREATE, tweet);
			} catch (error) {
				// TODO
			}
		});
	}
}

export interface CreateBookMapping {
	BlockedUsersBook: [book: BlockedUsersBook, options: BlockedUsersBookOptions];
	ComposedTweetsBook: [book: ComposedTweetsBook, options: ComposedTweetsBookOptions];
	FollowedListsBook: [book: FollowedListsBook, options: FollowedListsBookOptions];
	LikedByUsersBook: [book: LikedByUsersBook, options: LikedByUsersBookOptions];
	LikedTweetsBook: [book: LikedTweetsBook, options: LikedTweetsBookOptions];
	ListFollowersBook: [book: ListFollowersBook, options: ListFollowersBookOptions];
	ListMembersBook: [book: ListMembersBook, options: ListMembersBookOptions];
	ListTweetsBook: [book: ListTweetsBook, options: ListTweetsBookOptions];
	MemberOfListsBook: [book: MemberOfListsBook, options: MemberOfListsBookOptions];
	MutedUsersBook: [book: MutedUsersBook, options: MutedUsersBookOptions];
	OwnedListsBook: [book: OwnedListsBook, options: OwnedListsBookOptions];
	PinnedListsBook: [book: PinnedListsBook, options: PinnedListsBookOptions];
	RetweetedByUsersBook: [book: RetweetedByUsersBook, options: RetweetedByUsersBookOptions];
	SearchTweetsBook: [book: SearchTweetsBook, options: SearchTweetsBookOptions];
	SpaceTicketBuyersBook: [book: SpaceTicketBuyersBook, options: SpaceTicketBuyersBookOptions];
	TweetsCountBook: [book: TweetsCountBook, options: TweetsCountBookOptions];
	UserFollowersBook: [book: UserFollowersBook, options: UserFollowersBookOptions];
	UserFollowingsBook: [book: UserFollowingsBook, options: UserFollowingsBookOptions];
	UserMentioningTweetsBook: [book: UserMentioningTweetsBook, options: UserMentioningTweetsBookOptions];
}

export type CreateBookOptionType<K> = K extends keyof CreateBookMapping ? CreateBookMapping[K][1] : unknown[];

export type CreateBookReturnType<K> = K extends keyof CreateBookMapping ? CreateBookMapping[K][0] : unknown[];

const Books = {
	BlockedUsersBook,
	ComposedTweetsBook,
	FollowedListsBook,
	LikedByUsersBook,
	LikedTweetsBook,
	ListFollowersBook,
	ListMembersBook,
	ListTweetsBook,
	MemberOfListsBook,
	MutedUsersBook,
	OwnedListsBook,
	PinnedListsBook,
	RetweetedByUsersBook,
	SearchTweetsBook,
	SpaceTicketBuyersBook,
	TweetsCountBook,
	UserFollowersBook,
	UserFollowingsBook,
	UserMentioningTweetsBook,
};

export type CreateBookNameType = keyof typeof Books;
