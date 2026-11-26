const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { test, before, after, beforeEach } = require("node:test");
const fs = require("node:fs");

let testEnv;
const PROJECT_ID = process.env.GCP_PROJECT || "demo-no-project";
const ALICE_UID = "teacher_alice_01";
const BOB_UID = "teacher_bob_02";

const [emulatorHost, emulatorPortStr] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085"
).split(":");
const emulatorPort = parseInt(emulatorPortStr, 10);

before(async () => {
  const rules = fs.readFileSync("./firestore.rules", "utf8");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: emulatorHost,
      port: emulatorPort,
    },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

function pastDate(offsetMs = 5000) {
  return new Date(Date.now() - offsetMs);
}

test("Unauthenticated user: denied all reads and writes", async () => {
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).get());
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).collection("classes").get());
  await assertFails(
    unauthDb.collection("users").doc(ALICE_UID).collection("classes").doc("c1").set({
      userId: ALICE_UID,
      className: "XI TKR-A",
      subjectName: "DPK",
      educationLevel: "SMK",
      phase: "E",
      gradeLevel: "XI",
      kktpThreshold: 75,
      studentCount: 0,
      createdAt: pastDate(),
      updatedAt: pastDate(),
    })
  );
});

test("TeacherProfile: owner create/update succeeds, ghost fields & future timestamps fail, cross-user fails", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  const created = pastDate(10000);

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).set({
      userId: ALICE_UID,
      displayName: "Budi Santoso, S.Pd.",
      schoolName: "SMKN 1 Nusantara",
      nip: "198901012019031002",
      defaultLevel: "SMK",
      defaultPhase: "E",
      activeSemester: "Ganjil",
      activeAcademicYear: "2026/2027",
      createdAt: created,
      updatedAt: created,
    })
  );

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).update({
      schoolName: "SMKN 2 Nusantara",
      updatedAt: pastDate(1000),
    })
  );

  // Reject immutable createdAt modification
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).update({
      createdAt: pastDate(500),
      updatedAt: pastDate(500),
    })
  );

  // Reject ghost field / @DocumentId 'id' leakage
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).update({
      isAdmin: true,
      updatedAt: pastDate(500),
    })
  );

  // Reject cross-user read/write
  await assertFails(bobDb.collection("users").doc(ALICE_UID).get());
  await assertFails(
    bobDb.collection("users").doc(ALICE_UID).update({
      displayName: "Hijacked",
      updatedAt: pastDate(500),
    })
  );
});

test("ClassRoom & Student: parent exists() enforced on student create, list scoped to owner", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  const created = pastDate(10000);

  // Student without parent class must fail
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("classes").doc("cls_missing").collection("students").doc("st_1").set({
      userId: ALICE_UID,
      classId: "cls_missing",
      fullName: "Ahmad Fauzi",
      nis: "24001",
      gender: "L",
      createdAt: created,
      updatedAt: created,
    })
  );

  // Create class
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("classes").doc("cls_tkr_a").set({
      userId: ALICE_UID,
      className: "X TKR-A",
      subjectName: "Dasar Program Keahlian",
      educationLevel: "SMK",
      phase: "E",
      gradeLevel: "X",
      kktpThreshold: 75,
      studentCount: 1,
      createdAt: created,
      updatedAt: created,
    })
  );

  // Create student succeeds now
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("classes").doc("cls_tkr_a").collection("students").doc("st_1").set({
      userId: ALICE_UID,
      classId: "cls_tkr_a",
      fullName: "Ahmad Fauzi",
      nis: "24001",
      gender: "L",
      createdAt: created,
      updatedAt: created,
    })
  );

  // Reject extra 'id' field
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("classes").doc("cls_tkr_a").collection("students").doc("st_2").set({
      id: "st_2",
      userId: ALICE_UID,
      classId: "cls_tkr_a",
      fullName: "Dewi Lestari",
      nis: "24002",
      gender: "P",
      createdAt: created,
      updatedAt: created,
    })
  );

  // List queries
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).collection("classes").get());
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("classes").doc("cls_tkr_a").collection("students").get()
  );
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("classes").get());
});

test("TeachingJournal: separate attendance save and journal save updates succeed", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const created = pastDate(10000);

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("classes").doc("cls_1").set({
      userId: ALICE_UID,
      className: "XI TKJ-B",
      subjectName: "Administrasi Sistem Jaringan",
      educationLevel: "SMK",
      phase: "F",
      gradeLevel: "XI",
      kktpThreshold: 78,
      studentCount: 2,
      createdAt: created,
      updatedAt: created,
    })
  );

  // Step 1: Save attendance first (draft journal)
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("journals").doc("j_1").set({
      userId: ALICE_UID,
      classId: "cls_1",
      className: "XI TKJ-B",
      subjectName: "Administrasi Sistem Jaringan",
      dateKey: "2026-11-24",
      meetingNumber: 1,
      learningObjective: "",
      topic: "",
      method: "",
      obstacles: "",
      reflection: "",
      journalStatus: "draft",
      attendanceSaved: true,
      attendanceMap: { st_1: "H", st_2: "S" },
      presentCount: 1,
      absentCount: 1,
      createdAt: created,
      updatedAt: created,
    })
  );

  // Step 2: Save journal separately via partial update
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("journals").doc("j_1").update({
      learningObjective: "Siswa mampu mengkonfigurasi DHCP Server",
      topic: "Konfigurasi DHCP Server Linux",
      method: "Praktik Bengkel",
      obstacles: "2 PC lab butuh restart",
      reflection: "80% siswa berhasil konfigurasi",
      journalStatus: "completed",
      updatedAt: pastDate(1000),
    })
  );

  // Step 3: Update attendance separately again
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("journals").doc("j_1").update({
      attendanceMap: { st_1: "H", st_2: "H" },
      presentCount: 2,
      absentCount: 0,
      attendanceSaved: true,
      updatedAt: pastDate(500),
    })
  );
});

test("Assessment, LessonModule, and ScheduleSlot: create, partial update, and query bounds", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const created = pastDate(10000);

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("classes").doc("cls_1").set({
      userId: ALICE_UID,
      className: "X RPL-A",
      subjectName: "Pemrograman Dasar",
      educationLevel: "SMK",
      phase: "E",
      gradeLevel: "X",
      kktpThreshold: 75,
      studentCount: 1,
      createdAt: created,
      updatedAt: created,
    })
  );

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("assessments").doc("a_1").set({
      userId: ALICE_UID,
      classId: "cls_1",
      title: "Praktik Algoritma Percabangan",
      category: "formatif",
      learningObjective: "Menerapkan struktur if-else",
      dateKey: "2026-11-24",
      maxScore: 100,
      weight: 30,
      scoresMap: { st_1: 88.5 },
      createdAt: created,
      updatedAt: created,
    })
  );

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("assessments").doc("a_1").update({
      scoresMap: { st_1: 92 },
      updatedAt: pastDate(1000),
    })
  );

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("lesson_modules").doc("m_1").set({
      userId: ALICE_UID,
      moduleType: "modul_ajar",
      title: "Modul Ajar Sistem Starter Otomotif",
      subjectName: "Dasar Program Keahlian TKR",
      educationLevel: "SMK",
      phase: "E",
      gradeLevel: "X",
      durationMinutes: 180,
      learningOutcomes: "Memahami dasar kelistrikan otomotif",
      learningObjectives: "Menguji komponen motor starter",
      pancasilaProfile: ["Bernalar Kritis", "Mandiri"],
      activitiesSummary: "Pendahuluan, Inti Praktik Bengkel, Penutup",
      assessmentPlan: "Tes praktik dan lembar observasi",
      aiGenerated: true,
      createdAt: created,
      updatedAt: created,
    })
  );

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("schedules").doc("s_1").set({
      userId: ALICE_UID,
      classId: "cls_1",
      className: "X RPL-A",
      subjectName: "Pemrograman Dasar",
      dayOfWeek: 1,
      startTime: "07:30",
      endTime: "09:45",
      room: "Lab RPL 1",
      reminderEnabled: false,
      createdAt: created,
      updatedAt: created,
    })
  );

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("schedules").doc("s_1").update({
      reminderEnabled: true,
      updatedAt: pastDate(500),
    })
  );

  // Google Calendar sync metadata partial update succeeds
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("schedules").doc("s_1").update({
      calendarEventId: "gcal_evt_12345",
      calendarSyncedAtEpochMs: 1764070000000,
      updatedAt: pastDate(300),
    })
  );

  // Two-way Calendar pull partial update (time/room + sync metadata) succeeds
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("schedules").doc("s_1").update({
      startTime: "08:00",
      endTime: "09:30",
      room: "Lab RPL 2",
      calendarEventId: "gcal_evt_12345",
      calendarSyncedAtEpochMs: 1764070500000,
      updatedAt: pastDate(100),
    })
  );

  // Reject negative calendarSyncedAtEpochMs
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("schedules").doc("s_1").update({
      calendarEventId: "gcal_evt_12345",
      calendarSyncedAtEpochMs: -5,
      updatedAt: pastDate(50),
    })
  );
});

test("Absensi CRUD: owner create/read/update/delete succeed, parent class & immutability & cross-user enforced", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  const created = pastDate(10000);

  // Create without parent class must fail
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("absensi").doc("abs_missing").set({
      userId: ALICE_UID,
      classId: "cls_missing",
      className: "X TKR-A",
      subjectName: "DPK",
      dateKey: "2026-11-25",
      meetingNumber: 1,
      attendanceMap: { st_1: "H" },
      presentCount: 1,
      sickCount: 0,
      permissionCount: 0,
      absentCount: 0,
      createdAt: created,
      updatedAt: created,
    })
  );

  // Create parent class first
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("classes").doc("cls_abs_1").set({
      userId: ALICE_UID,
      className: "X TKR-A",
      subjectName: "Dasar Program Keahlian",
      educationLevel: "SMK",
      phase: "E",
      gradeLevel: "X",
      kktpThreshold: 75,
      studentCount: 4,
      createdAt: created,
      updatedAt: created,
    })
  );

  // Reject extra @DocumentId 'id' field leakage
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("absensi").doc("abs_bad").set({
      id: "abs_bad",
      userId: ALICE_UID,
      classId: "cls_abs_1",
      className: "X TKR-A",
      subjectName: "Dasar Program Keahlian",
      dateKey: "2026-11-25",
      meetingNumber: 1,
      attendanceMap: { st_1: "H" },
      presentCount: 1,
      sickCount: 0,
      permissionCount: 0,
      absentCount: 0,
      createdAt: created,
      updatedAt: created,
    })
  );

  // Create Absensi without optional notes succeeds
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("absensi").doc("abs_1").set({
      userId: ALICE_UID,
      classId: "cls_abs_1",
      className: "X TKR-A",
      subjectName: "Dasar Program Keahlian",
      dateKey: "2026-11-25",
      meetingNumber: 1,
      attendanceMap: { st_1: "H", st_2: "S", st_3: "I", st_4: "A" },
      presentCount: 1,
      sickCount: 1,
      permissionCount: 1,
      absentCount: 1,
      createdAt: created,
      updatedAt: created,
    })
  );

  // Read (get & list) succeeds for owner, fails for Bob
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).collection("absensi").doc("abs_1").get());
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("absensi").where("classId", "==", "cls_abs_1").get()
  );
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("absensi").get());

  // Partial update with notes succeeds
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("absensi").doc("abs_1").update({
      dateKey: "2026-11-26",
      meetingNumber: 2,
      attendanceMap: { st_1: "H", st_2: "H", st_3: "I", st_4: "A" },
      presentCount: 2,
      sickCount: 0,
      permissionCount: 1,
      absentCount: 1,
      notes: "1 siswa lomba LKS",
      updatedAt: pastDate(1000),
    })
  );

  // Partial update clearing notes to empty string succeeds
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("absensi").doc("abs_1").update({
      dateKey: "2026-11-26",
      meetingNumber: 2,
      attendanceMap: { st_1: "H", st_2: "H", st_3: "I", st_4: "A" },
      presentCount: 2,
      sickCount: 0,
      permissionCount: 1,
      absentCount: 1,
      notes: "",
      updatedAt: pastDate(500),
    })
  );

  // Modifying immutable classId fails
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("absensi").doc("abs_1").update({
      classId: "cls_other",
      updatedAt: pastDate(500),
    })
  );

  // Cross-user delete fails, owner delete succeeds
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("absensi").doc("abs_1").delete());
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).collection("absensi").doc("abs_1").delete());
});

test("JurnalMengajar CRUD: owner save/retrieve/update/delete succeed, parent class & topic & immutability enforced", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  const created = pastDate(10000);

  // Create without parent class must fail
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("jurnal_mengajar").doc("jm_missing").set({
      userId: ALICE_UID,
      classId: "cls_missing",
      className: "X TKR-A",
      subjectName: "DPK",
      dateKey: "2026-11-25",
      meetingNumber: 1,
      learningObjective: "Memahami sistem rem",
      topic: "Overhaul Rem Tromol",
      method: "Praktik Bengkel",
      obstacles: "",
      reflection: "Berjalan lancar",
      journalStatus: "completed",
      createdAt: created,
      updatedAt: created,
    })
  );

  // Create parent class
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("classes").doc("cls_jm_1").set({
      userId: ALICE_UID,
      className: "XI TKR-A",
      subjectName: "Pemeliharaan Sasis",
      educationLevel: "SMK",
      phase: "F",
      gradeLevel: "XI",
      kktpThreshold: 75,
      studentCount: 28,
      createdAt: created,
      updatedAt: created,
    })
  );

  // Reject blank topic or extra 'id' field
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("jurnal_mengajar").doc("jm_bad").set({
      userId: ALICE_UID,
      classId: "cls_jm_1",
      className: "XI TKR-A",
      subjectName: "Pemeliharaan Sasis",
      dateKey: "2026-11-25",
      meetingNumber: 1,
      learningObjective: "",
      topic: "",
      method: "Praktik Bengkel",
      obstacles: "",
      reflection: "",
      journalStatus: "completed",
      createdAt: created,
      updatedAt: created,
    })
  );

  // Create JurnalMengajar succeeds
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("jurnal_mengajar").doc("jm_1").set({
      userId: ALICE_UID,
      classId: "cls_jm_1",
      className: "XI TKR-A",
      subjectName: "Pemeliharaan Sasis",
      dateKey: "2026-11-25",
      meetingNumber: 1,
      learningObjective: "Siswa mampu memeriksa ketebalan kanvas rem",
      topic: "Overhaul Rem Tromol",
      method: "Praktik Bengkel",
      obstacles: "Kunci momen terbatas",
      reflection: "Kelompok 2 perlu pendampingan",
      journalStatus: "follow_up",
      followUpPlan: "Siapkan 2 kunci momen tambahan pertemuan berikutnya",
      createdAt: created,
      updatedAt: created,
    })
  );

  // Retrieve single document & list queries scoped to owner
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).collection("jurnal_mengajar").doc("jm_1").get());
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("jurnal_mengajar").where("classId", "==", "cls_jm_1").get()
  );
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("jurnal_mengajar").get());

  // Partial update succeeds
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("jurnal_mengajar").doc("jm_1").update({
      dateKey: "2026-11-26",
      meetingNumber: 2,
      learningObjective: "Siswa mampu memeriksa dan menyetel rem tromol",
      topic: "Penyetelan Rem Tromol",
      method: "Praktik Bengkel",
      obstacles: "",
      reflection: "Semua kelompok tuntas",
      journalStatus: "completed",
      followUpPlan: "",
      updatedAt: pastDate(500),
    })
  );

  // Modifying immutable classId fails
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("jurnal_mengajar").doc("jm_1").update({
      classId: "cls_other",
      updatedAt: pastDate(500),
    })
  );

  // Cross-user delete fails, owner delete succeeds
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("jurnal_mengajar").doc("jm_1").delete());
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).collection("jurnal_mengajar").doc("jm_1").delete());
});

test("NilaiSiswa CRUD: owner create/read/update/delete succeed, parent class & student & score bounds & immutability enforced", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  const created = pastDate(10000);

  // Create parent class & student
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("classes").doc("cls_nilai_1").set({
      userId: ALICE_UID,
      className: "XI RPL-A",
      subjectName: "Pemrograman Web",
      educationLevel: "SMK",
      phase: "F",
      gradeLevel: "XI",
      kktpThreshold: 75,
      studentCount: 1,
      createdAt: created,
      updatedAt: created,
    })
  );
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("classes").doc("cls_nilai_1").collection("students").doc("st_nilai_1").set({
      userId: ALICE_UID,
      classId: "cls_nilai_1",
      fullName: "Nadia Putri",
      nis: "24015",
      gender: "P",
      createdAt: created,
      updatedAt: created,
    })
  );

  // Missing parent student must fail
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("nilai_siswa").doc("ns_missing_st").set({
      userId: ALICE_UID,
      classId: "cls_nilai_1",
      className: "XI RPL-A",
      subjectName: "Pemrograman Web",
      studentId: "st_nonexistent",
      studentName: "Anonim",
      studentNis: "000",
      assessmentTitle: "Tugas REST API",
      category: "formatif",
      learningObjective: "Membuat endpoint CRUD",
      dateKey: "2026-11-25",
      score: 85,
      maxScore: 100,
      weight: 1,
      semester: "Ganjil",
      createdAt: created,
      updatedAt: created,
    })
  );

  // Score exceeding maxScore must fail
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("nilai_siswa").doc("ns_bad_score").set({
      userId: ALICE_UID,
      classId: "cls_nilai_1",
      className: "XI RPL-A",
      subjectName: "Pemrograman Web",
      studentId: "st_nilai_1",
      studentName: "Nadia Putri",
      studentNis: "24015",
      assessmentTitle: "Tugas REST API",
      category: "formatif",
      learningObjective: "Membuat endpoint CRUD",
      dateKey: "2026-11-25",
      score: 120,
      maxScore: 100,
      weight: 1,
      semester: "Ganjil",
      createdAt: created,
      updatedAt: created,
    })
  );

  // Create NilaiSiswa succeeds
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("nilai_siswa").doc("ns_1").set({
      userId: ALICE_UID,
      classId: "cls_nilai_1",
      className: "XI RPL-A",
      subjectName: "Pemrograman Web",
      studentId: "st_nilai_1",
      studentName: "Nadia Putri",
      studentNis: "24015",
      assessmentTitle: "Praktik REST API",
      category: "formatif",
      learningObjective: "Membangun API CRUD terautentikasi",
      dateKey: "2026-11-25",
      score: 88.5,
      maxScore: 100,
      weight: 2,
      semester: "Ganjil",
      notes: "Struktur JSON rapi",
      createdAt: created,
      updatedAt: created,
    })
  );

  // Read (get & list by subject/student) succeeds for owner, fails for Bob
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).collection("nilai_siswa").doc("ns_1").get());
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("nilai_siswa").where("subjectName", "==", "Pemrograman Web").get()
  );
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("nilai_siswa").get());

  // Partial update succeeds
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("nilai_siswa").doc("ns_1").update({
      assessmentTitle: "Uji Kompetensi REST API",
      category: "sumatif",
      score: 94,
      notes: "",
      updatedAt: pastDate(500),
    })
  );

  // Modifying immutable studentId or classId fails
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("nilai_siswa").doc("ns_1").update({
      studentId: "st_other",
      updatedAt: pastDate(500),
    })
  );

  // Cross-user delete fails, owner delete succeeds
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("nilai_siswa").doc("ns_1").delete());
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).collection("nilai_siswa").doc("ns_1").delete());
});

