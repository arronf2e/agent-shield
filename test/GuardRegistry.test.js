const { expect } = require("chai");
const { ethers } = require("hardhat");

const TARGET = "0x000000000000000000000000000000000000bEEF";
const HASH = ethers.keccak256(ethers.toUtf8Bytes("sample-report"));

describe("GuardRegistry", function () {
  let registry, guard, alice, bob, carol, dave, mallory;

  beforeEach(async function () {
    [alice, bob, carol, dave, mallory] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockAgentIdRegistry");
    registry = await Mock.deploy();

    await registry.mint("alice", alice.address);
    await registry.mint("bob", bob.address);
    await registry.mint("carol", carol.address);
    await registry.mint("dave", dave.address);
    // mallory holds no Agent ID

    const Guard = await ethers.getContractFactory("GuardRegistry");
    guard = await Guard.deploy(await registry.getAddress());
  });

  describe("register", function () {
    it("registers a holder with their own handle", async function () {
      await expect(guard.connect(alice).register("alice"))
        .to.emit(guard, "AgentRegistered")
        .withArgs(alice.address, ethers.keccak256(ethers.toUtf8Bytes("alice")), "alice");
      expect(await guard.isRegistered(alice.address)).to.equal(true);
      expect(await guard.agentCount()).to.equal(1n);
      const p = await guard.getProfile(alice.address);
      expect(p.handle).to.equal("alice");
    });

    it("rejects a wallet without an Agent ID", async function () {
      await expect(guard.connect(mallory).register("mallory"))
        .to.be.revertedWithCustomError(guard, "NotAgentIdHolder");
    });

    it("rejects registering with someone else's handle", async function () {
      await expect(guard.connect(alice).register("bob"))
        .to.be.revertedWithCustomError(guard, "HandleNotOwned");
    });

    it("rejects an unregistered handle", async function () {
      await expect(guard.connect(alice).register("ghost"))
        .to.be.revertedWithCustomError(guard, "HandleNotOwned");
    });

    it("rejects double registration", async function () {
      await guard.connect(alice).register("alice");
      await expect(guard.connect(alice).register("alice"))
        .to.be.revertedWithCustomError(guard, "AlreadyRegistered");
    });
  });

  describe("recordCheck", function () {
    it("records checks for registered agents and counts them", async function () {
      await guard.connect(alice).register("alice");
      await expect(guard.connect(alice).recordCheck(TARGET, 2, HASH))
        .to.emit(guard, "CheckRecorded")
        .withArgs(alice.address, TARGET, 2, HASH);
      await guard.connect(alice).recordCheck(TARGET, 0, HASH);
      expect(await guard.totalChecks()).to.equal(2n);
      const p = await guard.getProfile(alice.address);
      expect(p.checkCount).to.equal(2);
    });

    it("rejects unregistered callers", async function () {
      await expect(guard.connect(bob).recordCheck(TARGET, 0, HASH))
        .to.be.revertedWithCustomError(guard, "NotRegistered");
    });

    it("rejects the zero target", async function () {
      await guard.connect(alice).register("alice");
      await expect(guard.connect(alice).recordCheck(ethers.ZeroAddress, 0, HASH))
        .to.be.revertedWithCustomError(guard, "InvalidTarget");
    });
  });

  describe("community blocklist", function () {
    beforeEach(async function () {
      await guard.connect(alice).register("alice");
      await guard.connect(bob).register("bob");
      await guard.connect(carol).register("carol");
      await guard.connect(dave).register("dave");
    });

    it("blocks a target after 3 distinct agents stand behind reports", async function () {
      await guard.connect(alice).reportRisk(TARGET, HASH);
      expect(await guard.isBlocked(TARGET)).to.equal(false);

      await guard.connect(bob).confirmReport(0);
      expect(await guard.isBlocked(TARGET)).to.equal(false);

      await expect(guard.connect(carol).confirmReport(0))
        .to.emit(guard, "TargetBlocked")
        .withArgs(TARGET, 0);
      expect(await guard.isBlocked(TARGET)).to.equal(true);
    });

    it("reporter cannot confirm their own report", async function () {
      await guard.connect(alice).reportRisk(TARGET, HASH);
      await expect(guard.connect(alice).confirmReport(0))
        .to.be.revertedWithCustomError(guard, "ReporterCannotConfirm");
    });

    it("an agent cannot confirm twice", async function () {
      await guard.connect(alice).reportRisk(TARGET, HASH);
      await guard.connect(bob).confirmReport(0);
      await expect(guard.connect(bob).confirmReport(0))
        .to.be.revertedWithCustomError(guard, "AlreadyConfirmed");
    });

    it("unregistered wallets cannot report or confirm", async function () {
      await expect(guard.connect(mallory).reportRisk(TARGET, HASH))
        .to.be.revertedWithCustomError(guard, "NotRegistered");
      await guard.connect(alice).reportRisk(TARGET, HASH);
      await expect(guard.connect(mallory).confirmReport(0))
        .to.be.revertedWithCustomError(guard, "NotRegistered");
    });

    it("confirming a missing report reverts", async function () {
      await expect(guard.connect(bob).confirmReport(99))
        .to.be.revertedWithCustomError(guard, "ReportNotFound");
    });
  });
});
