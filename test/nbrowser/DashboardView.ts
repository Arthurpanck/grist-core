import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("DashboardView", function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup, "Dashboard");
    await gu.sendActions([
      ["AddTable", "Sales", [
        { id: "Region", type: "Choice" },
        { id: "Amount", type: "Numeric" },
      ]],
      ["BulkAddRecord", "Sales", [null, null, null, null], {
        Region: ["North", "South", "North", "East"],
        Amount: [10, 20, 30, 40],
      }],
    ]);
    await gu.openPage("Sales");
  });

  gu.bigScreen();
  afterEach(() => gu.checkForErrors());

  it("should show a friendly empty state", async function() {
    await gu.addNewSection(/Dashboard/, /Sales/);
    assert.isTrue(await driver.findWait(".test-dashboard-empty", 2000).isDisplayed());
    assert.isTrue(await driver.find(".test-dashboard-generate").isDisplayed());
  });

  it("should generate blocks from the table's metadata", async function() {
    await driver.find(".test-dashboard-generate").click();
    await gu.waitForServer();
    await gu.waitToPass(async () => {
      const values = await driver.findAll(".test-dashboard-block-kpi .test-dashboard-kpi-value", e => e.getText());
      // Number of rows, then the sum and the average of Amount.
      assert.deepEqual(values.slice(0, 3), ["4", "100", "25"]);
    });
    assert.isAbove((await driver.findAll(".test-dashboard-block-chart")).length, 0);
    assert.isFalse(await driver.find(".test-dashboard-empty").isPresent());
  });

  it("should update key figures when data changes", async function() {
    await gu.sendActions([["AddRecord", "Sales", null, { Region: "West", Amount: 100 }]]);
    await gu.waitToPass(async () => {
      const values = await driver.findAll(".test-dashboard-block-kpi .test-dashboard-kpi-value", e => e.getText());
      assert.deepEqual(values.slice(0, 2), ["5", "200"]);
    });
  });

  it("should allow deleting a block, and undoing it", async function() {
    const count = (await driver.findAll(".test-dashboard-block")).length;
    const block = await driver.find(".test-dashboard-block-kpi");
    await block.mouseMove();
    await block.find(".test-dashboard-block-menu").click();
    await driver.findWait(".test-dashboard-block-delete", 1000).click();
    await gu.waitForServer();
    assert.lengthOf(await driver.findAll(".test-dashboard-block"), count - 1);
    await gu.undo();
    assert.lengthOf(await driver.findAll(".test-dashboard-block"), count);
  });

  it("should add a block with the editor", async function() {
    const count = (await driver.findAll(".test-dashboard-block")).length;
    await driver.find(".test-dashboard-add-block").click();
    await driver.findWait(".test-dashboard-editor-kind-kpi", 1000).click();
    await driver.find(".test-modal-confirm").click();
    await gu.waitForServer();
    assert.lengthOf(await driver.findAll(".test-dashboard-block"), count + 1);
  });
});
