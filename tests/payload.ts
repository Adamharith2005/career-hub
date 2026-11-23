import type { Payload } from '../core/twoprofile.ts'

/**
 * FICTIONAL people and employers for tests and automated E2E. Nothing here belongs to a real person.
 * Mirrors the shape of the real private payload so every code path (proposal projects, user-reported figures,
 * unconfirmed facts, secondary education, dated/undated availability) is exercised.
 */
export function syntheticPayload(): Payload {
  return {
    schema: 1,
    profiles: [
      {
        key: 'adam', name: 'Alex', tagline: 'Data Science', badge: 'Applying now', applyPlan: 'Applying now for internships',
        identity: { fullName: 'ALEX TESTER BIN EXAMPLE', email: 'alex.tester@example.test', phone: '+60 12-000 0001', location: 'Testville, Selangor', github: 'https://github.com/alex-tester-fixture' },
        roles: ['data', 'ai_ml'], primary_role: 'data', prefs: { internshipStart: 'March 2027', internshipEnd: 'August 2027' },
        facts: [
          { key: 'a.edu', category: 'EDUCATION', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Bachelor of Computer Science (Data Science)', organization: 'Universiti Fixture', date_start: 'Oct 2024', date_end: 'Feb 2028 (Expected)', claim_text: 'CGPA: 3.11\nDean\'s List (Semester 3)', details: { level: 'bachelor' } },
          { key: 'a.edu2', category: 'EDUCATION', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Foundation in Science', organization: 'Fixture Foundation Centre', date_start: 'Jul 2023', date_end: 'Jun 2024', claim_text: 'CGPA: 3.22', details: { level: 'foundation' } },
          { key: 'a.edu3', category: 'EDUCATION', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Sijil Pelajaran Malaysia', organization: 'SMK Fixture', claim_text: '3A, 2B', details: { level: 'secondary' } },
          { key: 'a.s1', category: 'SKILL', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Programming', tools: ['Python', 'pandas', 'scikit-learn', 'SQL'] },
          { key: 'a.s2', category: 'SKILL', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Data Visualization & BI', tools: ['Power BI', 'Excel', 'DAX'] },
          { key: 'a.s3', category: 'SKILL', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Analytics & ML', tools: ['Data cleaning', 'EDA', 'model evaluation'] },
          { key: 'a.l', category: 'LANGUAGE', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Languages', tools: ['English (Fluent)', 'Malay (Native)'] },
          { key: 'a.p1', category: 'PROJECT', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Churn Prediction Study', date_end: 'Jun 2026', tools: ['Python', 'pandas', 'scikit-learn'], claim_text: 'Compared two classifiers on 1,200 synthetic customers.\nTuned with cross-validation.', details: { projectType: 'academic', context: 'Analytics coursework' } },
          { key: 'a.p2', category: 'PROJECT', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Sales Dashboard', date_end: 'Oct 2026', tools: ['Power BI', 'DAX'], claim_text: 'Built a 2-page Power BI dashboard.\nWrote 6 DAX measures.', details: { projectType: 'hackathon', context: 'Fixture Challenge, team project' } },
          { key: 'a.p3', category: 'PROJECT', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Warehouse Queries', date_end: 'Nov 2026', tools: ['SQL', 'Hadoop'], claim_text: 'Wrote 5 SQL queries over a small test dataset.', details: { projectType: 'academic', context: 'Warehousing coursework' } },
          { key: 'a.p4', category: 'PROJECT', status: 'REPO_OBSERVED', source_ref: 'fixture (unconfirmed)', title: 'Unconfirmed Side Project', confirmed: false, tools: ['Python'], claim_text: 'Should never appear in any document until confirmed.' },
          { key: 'a.lead', category: 'LEADERSHIP', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Head of Publicity', organization: 'Fixture Society Night 2026', date_end: '2026', claim_text: 'Coordinated 4 volunteers.' },
        ],
      },
      {
        key: 'akif', name: 'Sam', tagline: 'Information Systems', badge: 'June 2027', applyPlan: 'Plans to apply in June 2027',
        identity: { fullName: 'SAM SAMPLE BINTI DEMO', email: 'sam.sample@example.test', phone: '+60 12-000 0002', location: 'Demoville, Selangor', github: 'https://github.com/sam-sample-fixture' },
        roles: ['swe', 'cloud_devops', 'cyber'], primary_role: 'swe', prefs: {},
        facts: [
          { key: 's.edu', category: 'EDUCATION', status: 'USER_REPORTED', source_ref: 'fixture', title: 'Bachelor of Computer Science (Information Systems)', organization: 'Universiti Fixture', claim_text: 'CGPA: 3.49 (current)', details: { level: 'bachelor' } },
          { key: 's.edu2', category: 'EDUCATION', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Foundation in Science', organization: 'Universiti Fixture', claim_text: 'CGPA: 3.78', details: { level: 'foundation' } },
          { key: 's.s1', category: 'SKILL', status: 'USER_REPORTED', source_ref: 'fixture', title: 'Prototyping & Development', tools: ['React', 'TypeScript', 'Tailwind CSS'] },
          { key: 's.s2', category: 'SKILL', status: 'USER_REPORTED', source_ref: 'fixture', title: 'Cloud & Database', tools: ['Firebase Firestore', 'SQL'] },
          { key: 's.fyp', category: 'PROJECT', status: 'IN_PROGRESS', maturity: 'proposal', source_ref: 'fixture proposal', title: 'Proposed Cloud Misconfiguration Analyzer', date_end: 'In progress; expected Mar 2027', tools: [],
            claim_text: 'Proposed: a tool that checks Terraform files for AWS misconfigurations.\nPlanned evaluation: comparison against existing scanners. No results yet.', details: { projectType: 'academic', context: 'Proposed final-year project (FYP)' } },
          { key: 's.p1', category: 'PROJECT', status: 'DOCUMENTED', source_ref: 'fixture (team repo; role to be confirmed)', title: 'Budget Game', tools: ['React', 'TypeScript', 'Firebase'], claim_text: 'Team project: a web game that generates 10 days of budget scenarios.', details: { projectType: 'hackathon', context: 'Fixture Hack 2026, team project' } },
          { key: 's.p2', category: 'PROJECT', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Stock Tracker', tools: ['React', 'Firebase Firestore', 'Tailwind CSS'], claim_text: 'A multi-user web app for tracking stock levels.', details: { projectType: 'personal', context: 'Logistics app' } },
          { key: 's.award', category: 'AWARD', status: 'USER_REPORTED', source_ref: 'fixture', title: 'Demo Pitch: Top 5, Fixture Sprouts 2026', claim_text: 'Demo Pitch: Top 5, Fixture Sprouts 2026 (team project; individual contributions to be confirmed)', date_end: '2026' },
          { key: 's.exp', category: 'EXPERIENCE', status: 'DOCUMENTED', source_ref: 'fixture', title: 'Sales Advisor', organization: 'Fixture Electronics', date_end: 'Aug 2022', claim_text: 'Advised customers on IT hardware.' },
        ],
      },
    ],
  }
}
