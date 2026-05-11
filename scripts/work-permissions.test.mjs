import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "test-results/work-permissions";
await mkdir(outDir, { recursive: true });

const compiler = process.platform === "win32" ? "node_modules/.bin/tsc.cmd" : "node_modules/.bin/tsc";
const compile = spawnSync(
  compiler,
  [
    "worker/src/permissions.ts",
    "--target",
    "ES2022",
    "--module",
    "ES2022",
    "--moduleResolution",
    "Bundler",
    "--strict",
    "--skipLibCheck",
    "--types",
    "@cloudflare/workers-types",
    "--outDir",
    outDir,
  ],
  { stdio: "inherit" },
);

if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

const modulePath = await firstExistingPath([
  resolve(outDir, "permissions.js"),
  resolve(outDir, "worker/src/permissions.js"),
]);
const { canCrosspostToGallery, resolveGalleryCapabilities, resolveWorkCapabilities } = await import(pathToFileURL(modulePath));

const ownerCaps = {
  view: true,
  edit: true,
  upload_work: true,
  comment: true,
  manage_collaborators: true,
};

const uploadCaps = {
  view: true,
  edit: false,
  upload_work: true,
  comment: true,
  manage_collaborators: false,
};
const privateCaps = {
  view: false,
  edit: false,
  upload_work: false,
  comment: false,
  manage_collaborators: false,
};
const publicViewCaps = {
  view: true,
  edit: false,
  upload_work: false,
  comment: true,
  manage_collaborators: false,
};
const delegatedMember = {
  can_view: 1,
  can_edit: 1,
  can_upload_work: 1,
  can_comment: 1,
  can_manage_collaborators: 1,
};

const work = { created_by: "author" };
const author = { id: "author", role: "member" };
const galleryEditor = { id: "gallery-editor", role: "member" };
const admin = { id: "admin", role: "admin" };
const individualGallery = { owner_user_id: "owner", created_by: "owner", ownership_type: "self", whole_server_upload: 0 };
const ownIndividualGallery = { owner_user_id: "gallery-editor", created_by: "gallery-editor", ownership_type: "self", whole_server_upload: 0 };
const collaborativeGallery = { owner_user_id: "owner", created_by: "owner", ownership_type: "collaborative", whole_server_upload: 0 };
const ownCollaborativeGallery = { owner_user_id: "gallery-editor", created_by: "gallery-editor", ownership_type: "collaborative", whole_server_upload: 0 };
const everyoneGallery = { owner_user_id: "owner", created_by: "owner", ownership_type: "collaborative", whole_server_upload: 1 };

const checks = [];
function test(name, fn) {
  checks.push({ name, fn });
}

test("gallery editors cannot edit another member's work", () => {
  const result = resolveWorkCapabilities({
    galleryCaps: ownerCaps,
    work,
    user: galleryEditor,
    collaborator: null,
  });

  assert.equal(result.caps.view, true);
  assert.equal(result.caps.edit, false);
  assert.equal(result.version, false);
  assert.equal(result.crosspost, false);
});

test("whole-server upload permission does not imply work edit permission", () => {
  const result = resolveWorkCapabilities({
    galleryCaps: uploadCaps,
    work,
    user: galleryEditor,
    collaborator: null,
  });

  assert.equal(result.caps.view, true);
  assert.equal(result.caps.upload_work, true);
  assert.equal(result.caps.edit, false);
  assert.equal(result.version, false);
  assert.equal(result.crosspost, false);
});

test("work authors and explicit work collaborators can still edit", () => {
  assert.equal(resolveWorkCapabilities({ galleryCaps: uploadCaps, work, user: author }).caps.edit, true);
  assert.equal(
    resolveWorkCapabilities({
      galleryCaps: uploadCaps,
      work,
      user: galleryEditor,
      collaborator: { can_edit: 1, can_version: 0, can_comment: 0 },
    }).caps.edit,
    true,
  );
});

test("admin role alone does not grant content access", () => {
  const result = resolveWorkCapabilities({
    galleryCaps: privateCaps,
    work,
    user: admin,
    collaborator: null,
  });

  assert.equal(result.caps.view, false);
  assert.equal(result.caps.edit, false);
  assert.equal(result.caps.manage_collaborators, false);
  assert.equal(result.version, false);
  assert.equal(result.crosspost, false);
});

test("explicit version collaborators can version without metadata edit rights", () => {
  const result = resolveWorkCapabilities({
    galleryCaps: uploadCaps,
    work,
    user: galleryEditor,
    collaborator: { can_edit: 0, can_version: 1, can_comment: 0 },
  });

  assert.equal(result.caps.edit, false);
  assert.equal(result.version, true);
  assert.equal(result.crosspost, true);
});

test("any explicit work collaborator can crosspost without edit rights", () => {
  const result = resolveWorkCapabilities({
    galleryCaps: uploadCaps,
    work,
    user: galleryEditor,
    collaborator: { can_edit: 0, can_version: 0, can_comment: 0 },
  });

  assert.equal(result.caps.edit, false);
  assert.equal(result.version, false);
  assert.equal(result.crosspost, true);
});

test("crosspost targets allow Everyone and owned galleries", () => {
  assert.equal(canCrosspostToGallery({ caps: uploadCaps, gallery: everyoneGallery, user: galleryEditor }), true);
  assert.equal(canCrosspostToGallery({ caps: uploadCaps, gallery: ownIndividualGallery, user: galleryEditor }), true);
  assert.equal(canCrosspostToGallery({ caps: uploadCaps, gallery: ownCollaborativeGallery, user: galleryEditor }), true);
});

test("crosspost targets block non-owned Individual and Collaborative galleries", () => {
  assert.equal(canCrosspostToGallery({ caps: uploadCaps, gallery: individualGallery, user: galleryEditor }), false);
  assert.equal(canCrosspostToGallery({ caps: uploadCaps, gallery: collaborativeGallery, user: galleryEditor }), false);
  assert.equal(canCrosspostToGallery({ caps: uploadCaps, gallery: individualGallery, user: admin }), false);
  assert.equal(canCrosspostToGallery({ caps: { ...uploadCaps, upload_work: false }, gallery: collaborativeGallery, user: galleryEditor }), false);
});

test("Individual gallery members cannot gain upload, edit, or manage capabilities", () => {
  const result = resolveGalleryCapabilities({
    baseCaps: publicViewCaps,
    gallery: individualGallery,
    member: delegatedMember,
  });

  assert.equal(result.view, true);
  assert.equal(result.comment, true);
  assert.equal(result.upload_work, false);
  assert.equal(result.edit, false);
  assert.equal(result.manage_collaborators, false);
});

test("Collaborative gallery members can still use delegated capabilities", () => {
  const result = resolveGalleryCapabilities({
    baseCaps: publicViewCaps,
    gallery: collaborativeGallery,
    member: delegatedMember,
  });

  assert.equal(result.view, true);
  assert.equal(result.comment, true);
  assert.equal(result.upload_work, true);
  assert.equal(result.edit, true);
  assert.equal(result.manage_collaborators, true);
});

let passed = 0;
for (const check of checks) {
  try {
    check.fn();
    passed += 1;
    console.log(`ok - ${check.name}`);
  } catch (error) {
    console.error(`not ok - ${check.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

if (!process.exitCode) console.log(`work permission checks passed (${passed}/${checks.length})`);

async function firstExistingPath(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next tsc output shape.
    }
  }
  throw new Error(`Could not find compiled permissions module in ${outDir}`);
}
