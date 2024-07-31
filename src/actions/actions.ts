'use server'

import { unstable_cache as cache, unstable_noStore as noStore, revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ApifyClient } from 'apify-client'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { toast } from 'sonner'

import { UserCardData } from '@/app/top-list'
import { db } from '@/drizzle/db'
import { InsertUser, SelectUser, users } from '@/drizzle/schema'

/**
 * Retrieves a user from the database by their username.
 * @param {Object} params - The parameters for the function.
 * @param {SelectUser['username']} params.username - The username of the user to retrieve.
 * @returns {Promise<SelectUser | undefined>} The user object if found, undefined otherwise.
 */
export const getUser = async ({ username }: { username: SelectUser['username'] }) => {
  noStore()
  return await db.query.users.findFirst({ where: sql`LOWER(${users.username}) = ${username.toLowerCase()}` })
}

/**
 * Retrieves all users from the database.
 * @returns {Promise<SelectUser[]>} An array of all user objects.
 */
export const getUsers = async () => {
  noStore()
  const data = await db.select({ username: users.username }).from(users)
  return data
}

const featuredUsernames = [
  'yoheinakajima',
  'MattPRD',
  'benparr',
  'jowyang',
  'saranormous',
  'swyx',
  'azeem',
  'unable0_',
  'bertie_ai',
  'kozerafilip',
  'AlexReibman',
  'bentossell',
]
/**
 * Retrieves the top 12 users based on follower count.
 */
export const getTop = cache(async (): Promise<UserCardData[]> => {
  return db.query.users.findMany({
    where: eq(users.wordwareCompleted, true),
    orderBy: desc(users.followers),
    limit: 12,
    columns: {
      id: true,
      username: true,
      name: true,
      profilePicture: true,
      followers: true,
    },
  })
}, ['top-users'])

export const getFeatured = cache(async (): Promise<UserCardData[]> => {
  return await db.query.users.findMany({
    where: inArray(users.username, featuredUsernames),
    orderBy: desc(users.followers),
    columns: {
      id: true,
      username: true,
      name: true,
      profilePicture: true,
      followers: true,
    },
  })
}, ['featured-users'])

/**
 * Inserts a new user into the database.
 * @param {Object} params - The parameters for the function.
 * @param {InsertUser} params.user - The user object to insert.
 */
export const insertUser = async ({ user }: { user: InsertUser }) => {
  await db.insert(users).values(user)
}

/**
 * Updates an existing user in the database.
 * @param {Object} params - The parameters for the function.
 * @param {InsertUser} params.user - The user object with updated information.
 * @throws {Error} If the username is not provided.
 */
export const updateUser = async ({ user }: { user: InsertUser }) => {
  if (!user.username) {
    throw new Error('Username is required for updating a user')
  }

  await db.update(users).set(user).where(eq(users.username, user.username))
}

/**
 * Handles the process of adding a new username to the system.
 * If the user exists, redirects to their page. If not, scrapes their profile and adds them.
 * @param {Object} params - The parameters for the function.
 * @param {string} params.username - The username to process.
 */
export const handleNewUsername = async ({ username }: { username: string }) => {
  // First, check if the user already exists. If yes, just redirect to user's page.
  const user = await getUser({ username })
  if (user) redirect(`/${username}`)

  // If user does not exist, scrape the profile and then redirect to user's page.
  const { data, error } = await scrapeProfile({ username })
  console.log('🟣 | file: actions.ts:90 | handleNewUsername | error:', error, 'data', data)

  if (data && !error) {
    const user = {
      ...data,
      profileScraped: true,
      error: null,
    }
    await insertUser({ user })
    redirect(`/${data?.username}`)
  }
  if (!data && error) {
    return {
      data: null,
      error: error,
    }
  }
}

// Initialize the Apify client with the API key
const apifyClient = new ApifyClient({
  token: process.env.APIFY_API_KEY,
})

/**
 * Scrapes a Twitter profile using the Apify API.
 * @param {Object} params - The parameters for the function.
 * @param {string} params.username - The Twitter username to scrape.
 * @returns {Promise<{error: string | null, data: object | null}>} The scraped profile data or an error.
 */
export const scrapeProfile = async ({ username }: { username: string }) => {
  const input = {
    startUrls: [`https://twitter.com/${username}`],
    twitterHandles: [username],
    getFollowers: true,
    getFollowing: true,
    maxItems: 1,
    customMapFunction: '(object) => { return {...object} }',
  }
  try {
    const run = await apifyClient.actor('apidojo/twitter-user-scraper').call(input)
    // console.log('🟣 | file: actions.ts:72 | scrapeProfile | run:', run)
    if (run.status === 'FAILED') throw new Error(`Scraping Error: ${run.statusMessage}`)

    const { items: profiles } = await apifyClient.dataset(run.defaultDatasetId).listItems()
    const profile = profiles[0]
    const profilePicture = profile.profilePicture as string

    if (!profile || Object.keys(profile).length === 0) throw new Error('No profile found')

    return {
      error: null,
      data: {
        username: profile.userName as string,
        url: profile.url as string,
        name: profile.name as string,
        profilePicture: profilePicture.replace('_normal.', '_400x400.'),
        description: profile.description as string,
        location: profile.location as string,
        fullProfile: profile as object,
        followers: profile.followers as number,
      },
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'No profile found',
    }
  }
}

/**
 * Scrapes tweets from a Twitter profile using the Apify API.
 * @param {Object} params - The parameters for the function.
 * @param {string} params.username - The Twitter username to scrape tweets from.
 * @returns {Promise<{data: object[] | null, error: any}>} The scraped tweets or an error.
 */
export const scrapeTweets = async ({ username }: { username: string }) => {
  const input = {
    startUrls: [`https://twitter.com/${username}`],
    maxItems: 12,
    sort: 'Latest',
    tweetLanguage: 'en',
    customMapFunction: `(object) => { 
      return {
        type: object.type,
        text: object.text,
        source: object.source,
        retweetCount: object.retweetCount,
        replyCount: object.replyCount,
        likeCount: object.likeCount,
        quoteCount: object.quoteCount,
        viewCount: object.viewCount,
        createdAt: object.createdAt,
        lang: object.lang,
        bookmarkCount: object.bookmarkCount,
        isReply: object.isReply,
        fastFollowersCount: object.fastFollowersCount,
        favouritesCount: object.favouritesCount,
        isRetweet: object.isRetweet,
        isQuote: object.isQuote,
      }
    }`,
  }

  try {
    const run = await apifyClient.actor('apidojo/tweet-scraper').call(input)
    const { items: tweets } = await apifyClient.dataset(run.defaultDatasetId).listItems()
    // console.log('🟣 | file: actions.ts:143 | scrapeTweets | tweets:', tweets)

    return { data: tweets, error: null }
  } catch (error) {
    return {
      data: null,
      error: error,
    }
  }
}

/**
 * Processes a scraped user by updating their information and scraping their tweets.
 * @param {Object} params - The parameters for the function.
 * @param {string} params.username - The username of the user to process.
 * @returns {Promise<object[] | undefined>} The scraped tweets if successful, undefined otherwise.
 */
export const processScrapedUser = async ({ username }: { username: string }) => {
  let user = await getUser({ username })

  if (!user) {
    throw Error(`User not found: ${username}`)
  }

  if (!user.tweetScrapeStarted) {
    user = {
      ...user,
      tweetScrapeStarted: true,
    }
    await updateUser({ user })
    // console.log('twitter scrap started')
    let tweets
    let error
    try {
      const res = await scrapeTweets({ username })
      tweets = res.data
      error = res.error
      if (!tweets) throw new Error('No tweets found')
    } catch (e) {
      error = e
      toast.warning('Tweet scraping failed. Trying again...)')
      try {
        const res = await scrapeTweets({ username })
        tweets = res.data
        error = res.error
        console.error('🟣 | file: actions.ts:252 | processScrapedUserFirst | e:', e)
        if (!tweets) throw new Error('No tweets found')
      } catch (e) {
        console.error('🟣 | file: actions.ts:255 | processScrapedUserSecond | e:', e)
        toast.warning(
          "Tweet scraping failed a second time. Apologies - we're experiencing very high traffic at the moment. Please check that the linked profile has tweets and try again in a few minutes. Thank you for your patience.",
        )
        return {
          ...user,
          error: JSON.stringify(e),
        }
      }
    }
    console.log('🟣 | file: actions.ts:143 | processScrapedUser | tweets:', tweets?.length)
    if (tweets && !error) {
      user = {
        ...user,
        tweets: tweets,
        tweetScrapeCompleted: true,
      }
      await updateUser({ user })
      return tweets
    }
    if (error) {
      user = {
        ...user,
        error: JSON.stringify(error),
      }

      await updateUser({ user })
    }
  }
}

/**
 * Creates a contact in Loops.so with the given email.
 * @param {Object} params - The parameters for the function.
 * @param {string} params.email - The email address of the contact to create.
 * @returns {Promise<{success: boolean, error?: any}>} An object indicating success or failure.
 */
export const createLoopsContact = async ({ email }: { email: string }) => {
  const options = {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.LOOPS_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email,
      source: 'twitter-personality',
      subscribed: true,
    }),
  }

  try {
    const response = await fetch('https://app.loops.so/api/v1/contacts/create', options)
    await response.json()

    return { success: true }
  } catch (error) {
    return { success: false, error: error }
  }
}

export const unlockGeneration = async ({ username, email }: { username: string; email: string }) => {
  const options = {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.LOOPS_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email,
      source: 'twitter-personality',
      subscribed: true,
      userGroup: 'Twitter Personality - PAYWALL',
    }),
  }

  try {
    const response = await fetch('https://app.loops.so/api/v1/contacts/create', options)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || response.statusText)
    }
    unlockUser({ username: username.replace('/', ''), unlockType: 'email' })

    revalidatePath(`/${username}`)
    return { success: true }
  } catch (error) {
    console.log('🟣 | file: actions.ts:356 | unlockGeneration | error:', error)
    if (error instanceof Error) {
      return { success: false, error: error.message }
    }
    return { success: false, error: 'An unknown error occurred' }
  }
}

/**
 * Unlocks a user by setting their 'unlocked' property to true and adding an 'unlockType'.
 * @param {Object} params - The parameters for the function.
 * @param {string} params.username - The username of the user to unlock.
 * @param {string} params.unlockType - The type of unlock to apply.
 * @returns {Promise<{success: boolean, error?: string}>} An object indicating success or failure.
 */
export const unlockUser = async ({ username, unlockType }: { username: string; unlockType: 'email' | 'stripe' | 'free' }) => {
  try {
    const user = await getUser({ username })
    if (!user) {
      throw new Error(`User not found: ${username}`)
    }

    const updatedUser = {
      ...user,
      unlocked: true,
      unlockType: unlockType,
    }

    await updateUser({ user: updatedUser })

    return { success: true }
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message }
    }
    return { success: false, error: 'An unknown error occurred' }
  }
}
