const Apify = require('apify')

const getInnerText = async (page, selector) => page.$eval(selector, el => el.textContent)
const numberify = string => Number(string.replace(/[^\d.]+/, '') || 0)

Apify.main(async () => {
  const input = await Apify.getValue('INPUT')

  // Object from `./apify_storage/key_value_stores/default/INPUT.json`
  if (!input || !input.keyword) throw new Error('INPUT must contain a keyword!')

  const browser = await Apify.launchPuppeteer({
    // makes the browser "headless", meaning that no visible browser window will open
    headless: true
  })

  console.log(`Searching for keyword ${input.keyword}...`)
  const searchResultsPage = await browser.newPage()
  await searchResultsPage.goto(`https://www.amazon.com/s/?field-keywords=${input.keyword}!`)

  // This is the crawler queue that is populated with URLs to fetch
  const requestQueue = await Apify.openRequestQueue()

  // Define the URL pattern we want to follow from the search result page.
  // This is the URL pattern of the product details page:
  // https://www.amazon.com/$titleKeywods/dp/$asin/
  const pseudoUrls = [
    new Apify.PseudoUrl('https://www.amazon.com/[.*]/dp/[.*]')
  ]

  // Extract and enqueue URLs to crawl from the page.
  await Apify.utils.puppeteer.enqueueLinks(
    // page from which to extract URLs
    searchResultsPage,

    // selector under which to look for URLs
    '#s-results-list-atf a.s-access-detail-page',

    // pseudo URL object describing what URL format to look for
    pseudoUrls,

    // which queue to add the extracted URLs to
    requestQueue
  )

  const crawler = new Apify.PuppeteerCrawler({
    // We've already created a browser instance manually, this will reuse this instance, otherwise
    // a new instance would open up and we'd have 2 browsers running.
    launchPuppeteerFunction: () => browser,

    // This function will be called on every successful product details page fetch:
    // productDetailsPage is the following Puppeteer object:
    // https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pageselector
    handlePageFunction: async ({ request, page: productDetailsPage }) => {
      const title = await productDetailsPage.title()

      // The following CSS selector handles different variants of page layouts and pricing types.
      // It is by no means exhaustive, but the ones I found were used in this category.
      const buyBox = await getInnerText(productDetailsPage,
        '#price_inside_buybox, #newBuyBoxPrice, #soldByThirdParty .a-color-price')

      // Save data in storage.
      await Apify.pushData({
        title,
        url: request.url,
        buyBoxPrice: numberify(buyBox)
      })
    },

    requestQueue,
    maxRequestsPerCrawl: 100,
    maxConcurrency: 5
  })

  await crawler.run()
  await browser.close()
})