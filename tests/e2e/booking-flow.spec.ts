import { expect, type Page, test } from "@playwright/test";

/**
 * The core journey, end to end through the real stack (Next.js, Better Auth,
 * Postgres with RLS, the availability engine and the exclusion constraint):
 *
 *   sign up -> create org -> add service -> customer books on the public
 *   page -> the booking shows up in the owner's dashboard.
 */
const run = Date.now().toString(36);
const owner = { name: "Paula Owner", email: `owner-${run}@e2e.test`, password: "e2e-password-123" };
const slug = `e2e-${run}`;
const customer = { name: "Carla Customer", email: `carla-${run}@e2e.test` };

async function signUp(page: Page, user: { name: string; email: string; password: string }) {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

test.describe.serial("booking journey", () => {
  test("owner signs up, creates a business and a service", async ({ page }) => {
    await signUp(page, owner);

    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByLabel("Business name").fill(`E2E Clinic ${run}`);
    await page.getByLabel("Booking page URL").fill(slug);
    await page.getByRole("button", { name: "Create business" }).click();

    await expect(page).toHaveURL(new RegExp(`/app/${slug}$`));
    await expect(page.getByRole("heading", { name: /Good to see you, Paula/ })).toBeVisible();

    await page.getByRole("link", { name: "Services" }).click();
    await page.getByRole("button", { name: "New service" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Initial consultation");
    await dialog.getByLabel("Duration (min)").fill("30");
    await dialog.getByLabel(/Price/).fill("50");
    await dialog.getByRole("button", { name: "Save service" }).click();
    await expect(page.getByText("Service created")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Initial consultation" })).toBeVisible();
  });

  test("a customer books on the public page", async ({ page }) => {
    await page.goto(`/b/${slug}`);
    await expect(page.getByRole("heading", { name: `E2E Clinic ${run}` })).toBeVisible();

    // The only service is preselected; wait for the engine's slots.
    const firstSlot = page.getByTestId("slot").first();
    await expect(firstSlot).toBeVisible();
    await firstSlot.click();

    await page.getByLabel("Full name").fill(customer.name);
    await page.getByLabel("Email").fill(customer.email);
    await page.getByRole("button", { name: "Confirm booking" }).click();

    await expect(page.getByTestId("booking-status")).toHaveText("You're booked!");
    await expect(page.getByText("Initial consultation")).toBeVisible();
  });

  test("the booking appears in the owner's dashboard", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(owner.email);
    await page.getByLabel("Password").fill(owner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/${slug}`));

    await page.getByRole("link", { name: "Bookings" }).click();
    const row = page.getByRole("row", { name: new RegExp(customer.name) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Confirmed")).toBeVisible();
    await expect(row.getByText("Initial consultation")).toBeVisible();
  });

  test("a deposit goes through checkout and the signed webhook confirms the booking", async ({ page }) => {
    // Owner adds a service that requires a deposit.
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(owner.email);
    await page.getByLabel("Password").fill(owner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/${slug}`));
    await page.goto(`/app/${slug}/services`);
    await page.getByRole("button", { name: "New service" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Deep tissue massage");
    await dialog.getByLabel("Duration (min)").fill("60");
    await dialog.getByLabel(/Price/).fill("80");
    await dialog.getByLabel("Deposit").fill("20");
    await dialog.getByRole("button", { name: "Save service" }).click();
    await expect(page.getByText("Service created")).toBeVisible();

    // Customer books it: the slot is held and they're sent to checkout.
    await page.goto(`/b/${slug}`);
    await page.getByRole("button", { name: /Deep tissue massage/ }).click();
    await page.getByTestId("slot").first().click();
    await page.getByLabel("Full name").fill("Dora Deposit");
    await page.getByLabel("Email").fill(`dora-${run}@e2e.test`);
    await page.getByRole("button", { name: /Continue to pay \$20\.00 deposit/ }).click();

    await expect(page).toHaveURL(/\/checkout\//);
    await expect(page.getByText("$20.00")).toBeVisible();
    await page.getByRole("button", { name: /Pay with test card/ }).click();

    await expect(page.getByTestId("booking-status")).toHaveText("You're booked!");
    await expect(page.getByText("Deep tissue massage")).toBeVisible();
  });

  test("the owner of another business cannot open this organization's dashboard", async ({ page }) => {
    await signUp(page, { name: "Outsider", email: `outsider-${run}@e2e.test`, password: "e2e-password-123" });
    await expect(page).toHaveURL(/\/onboarding$/);
    // Being an owner *somewhere* must not grant anything here.
    await page.getByLabel("Business name").fill(`Rival ${run}`);
    await page.getByLabel("Booking page URL").fill(`rival-${run}`);
    await page.getByRole("button", { name: "Create business" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/rival-${run}$`));

    const response = await page.goto(`/app/${slug}/bookings`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText(customer.name)).toHaveCount(0);
  });
});
