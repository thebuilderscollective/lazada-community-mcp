import assert from "node:assert/strict";
import test from "node:test";
import { searchResultFromPayload } from "../dist/redmart.js";
import { extractProductContent } from "../dist/product-content.js";
import { guardSearchRelevance } from "../dist/search-relevance.js";
import { returnToBackgroundAfterLogin } from "../dist/login.js";
const payload = (names) => ({
  mods: {
    listItems: names.map((name, i) => ({
      name,
      itemId: String(i + 1),
      price: 2,
    })),
  },
  mainInfo: { totalResults: names.length },
});
test("protein-chip fallback is not presented as relevant groceries or catalog-wide availability", () => {
  const result = searchResultFromPayload(
    payload(["Danish Pilsner Beer", "Soda Water Case", "Fresh Coriander"]),
    "protein chips",
    1,
    3,
  );
  assert.equal(result.count, 0);
  assert.deepEqual(result.results, []);
  assert.equal(result.relevance.status, "no_relevant_matches");
  assert.equal(result.totalAvailable, null);
  assert.equal(result.storefrontTotalAvailable, 3);
  assert.equal(
    searchResultFromPayload({ broken: true }, "protein chips", 1, 3),
    null,
  );
});
test("relevance guard keeps broad categories, synonyms and partial title candidates honestly", () => {
  for (const [query, names] of [
    ["healthy snacks", ["Roasted Almonds", "Dried Mango"]],
    ["vegetables", ["Broccoli", "Carrots"]],
    ["groceries", ["Broccoli", "Oat Milk"]],
    ["crisps", ["Potato Chips"]],
    ["cilantro", ["Fresh Coriander"]],
    ["aubergine", ["Eggplant"]],
    ["chickpeas", ["Garbanzo Beans"]],
    ["protein chips", ["Lentil Chips"]],
  ]) {
    assert.equal(
      guardSearchRelevance(
        names.map((name) => ({ name })),
        query,
      ).products.length,
      names.length,
      query,
    );
  }
  const result = searchResultFromPayload(
    payload(["Soda Water", "Organic Oat Milk"]),
    "oat milk",
    1,
    1,
  );
  assert.equal(result.results[0].name, "Organic Oat Milk");
  assert.equal(result.relevance.rejectedCount, 1);
});
test("verified attribute paths return plain labelled content without guessing nutrition from marketing", () => {
  const fields = {
    attributes_grocer: {
      a: {
        data: {
          attributes: [
            {
              title: "About Product",
              description: { text: "<b>A grocery</b> &amp; more" },
            },
            {
              title: "Dietary Information",
              description: { text: "Nutri Grade B; contains vitamins" },
            },
            { title: "Ingredients", description: { text: "Oats, water" } },
            {
              title: "Nutrition Information",
              description: { text: "Per 100ml: energy 40 kcal" },
            },
          ],
        },
      },
    },
    product_attributes_grocer: {
      a: { data: { attributes: [{ name: "Pack Size", value: "500 g" }] } },
    },
  };
  const result = extractProductContent(fields, "a");
  assert.equal(result.description, "A grocery & more");
  assert.equal(result.ingredients[0].value, "Oats, water");
  assert.equal(result.nutrition.length, 1);
  assert.equal(result.specifications[0].value, "500 g");
  const missing = extractProductContent(fields, "other");
  assert.equal(missing.contentCoverage.ingredients, "unavailable");
  assert.deepEqual(missing.attributes, []);
  fields.attributes_grocer.a.data.attributes.splice(2);
  assert.equal(
    extractProductContent(fields, "a").contentCoverage.nutrition,
    "unavailable",
  );
  assert.equal(
    extractProductContent(null, null).contentCoverage.description,
    "unavailable",
  );
});
test("completed human login closes only the locally owned visible browser when background mode is enabled", async () => {
  let closed = 0;
  const browser = {
    status: () => ({ externallyOwned: false, headless: false }),
    exists: () => true,
    close: async () => {
      closed++;
    },
  };
  assert.equal(await returnToBackgroundAfterLogin(browser, true), true);
  assert.equal(closed, 1);
  assert.equal(await returnToBackgroundAfterLogin(browser, false), false);
  assert.equal(
    await returnToBackgroundAfterLogin(
      { ...browser, status: () => ({ externallyOwned: true, headless: null }) },
      true,
    ),
    false,
  );
  assert.equal(
    await returnToBackgroundAfterLogin(
      {
        ...browser,
        status: () => ({ externallyOwned: false, headless: true }),
      },
      true,
    ),
    false,
  );
  assert.equal(closed, 1);
});
