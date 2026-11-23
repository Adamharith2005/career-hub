export const ROLE_FAMILIES = [
  { key: 'swe', label: 'Software Engineer / Full-Stack' },
  { key: 'frontend', label: 'Frontend Developer' },
  { key: 'backend', label: 'Backend Developer' },
  { key: 'ai_ml', label: 'AI / Machine Learning' },
  { key: 'data', label: 'Data Science / Analytics / BI' },
  { key: 'cyber', label: 'Cybersecurity' },
  { key: 'cloud_devops', label: 'Cloud / DevOps / Platform' },
  { key: 'qa', label: 'QA / Software Testing' },
  { key: 'it_support', label: 'IT Support / Networks / Systems' },
  { key: 'other', label: 'Other CS / IT role' },
] as const
export type RoleFamily = (typeof ROLE_FAMILIES)[number]['key']
export const roleLabel = (k: string) => ROLE_FAMILIES.find((r) => r.key === k)?.label ?? k

/** Keywords used to classify free text (company role lists, job titles) into role families. Order = priority. */
export const ROLE_KEYWORDS: Record<Exclude<RoleFamily, 'other'>, RegExp> = {
  cyber: /cyber|security|soc\b|forensic|devsecops|penetration|infosec|threat/i,
  ai_ml: /\bai\b|machine learning|\bml\b|computer vision|llm|deep learning|nlp|data science|ai engineer/i,
  data: /data (analy|engineer|scien)|analytics|\bbi\b|business intelligence|etl|database/i,
  qa: /\bqa\b|test(ing|er)|quality assurance|automation engineer/i,
  cloud_devops: /cloud|devops|infrastructure|sre\b|platform|linux|data cent(re|er)|kubernetes/i,
  it_support: /it support|technical support|help ?desk|network|noc\b|system(s)? (admin|engineer)|server|it operations|it systems|sysadmin|latihan industri/i,
  frontend: /front-?end|\bui\b|\bux\b|web developer|react|web (app|dev)/i,
  backend: /back-?end|api|integration|edi\b/i,
  swe: /software|full-?stack|developer|programmer|application dev|engineer/i,
}

export function classifyRoleFamilies(text: string): RoleFamily[] {
  const out: RoleFamily[] = []
  for (const [k, re] of Object.entries(ROLE_KEYWORDS)) if (re.test(text)) out.push(k as RoleFamily)
  return out
}

export const APP_STATUSES = [
  'DISCOVERED', 'SAVED', 'PREPARING', 'READY_TO_APPLY', 'APPLIED', 'SCREENING', 'ASSESSMENT',
  'INTERVIEW', 'OFFER', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'NOT_PURSUED',
] as const
export type AppStatus = (typeof APP_STATUSES)[number]
export const STATUS_LABEL: Record<AppStatus, string> = {
  DISCOVERED: 'Discovered', SAVED: 'Saved', PREPARING: 'Preparing', READY_TO_APPLY: 'Prepared',
  APPLIED: 'Applied', SCREENING: 'Screening', ASSESSMENT: 'Assessment', INTERVIEW: 'Interview',
  OFFER: 'Offer', ACCEPTED: 'Accepted', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn', NOT_PURSUED: 'Not pursued',
}
export const TERMINAL: AppStatus[] = ['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'NOT_PURSUED']
export const PRE_APPLY: AppStatus[] = ['DISCOVERED', 'SAVED', 'PREPARING', 'READY_TO_APPLY']
export const POST_APPLY: AppStatus[] = ['SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'ACCEPTED']

// ---- Technology dictionary: canonical name -> aliases. Used for JD matching AND fact-checking. ----
const TECH: Record<string, string[]> = {
  Python: ['python'], Java: ['java'], JavaScript: ['javascript', 'js', 'ecmascript'], TypeScript: ['typescript', 'ts'],
  'C++': ['c++'], 'C#': ['c#', 'csharp'], '.NET': ['.net', 'dotnet', 'asp.net'], Go: ['golang'], Rust: ['rust'], PHP: ['php'], Kotlin: ['kotlin'],
  Swift: ['swift'], Dart: ['dart'], Flutter: ['flutter'], 'R': [], MATLAB: ['matlab'], Bash: ['bash', 'shell scripting', 'shell script'], PowerShell: ['powershell'],
  React: ['react', 'react.js', 'reactjs'], 'Next.js': ['next.js', 'nextjs'], Vue: ['vue', 'vue.js'], Angular: ['angular'], Svelte: ['svelte'],
  'Node.js': ['node.js', 'nodejs', 'node'], Express: ['express', 'express.js'], FastAPI: ['fastapi'], Flask: ['flask'], Django: ['django'],
  'Spring Boot': ['spring boot', 'springboot', 'spring'], Laravel: ['laravel'], 'Tailwind CSS': ['tailwind', 'tailwindcss', 'tailwind css'],
  HTML: ['html', 'html5'], CSS: ['css', 'css3'], Vite: ['vite'], Redux: ['redux'], GraphQL: ['graphql'], 'REST APIs': ['rest', 'restful', 'rest api', 'rest apis'],
  SQL: ['sql'], MySQL: ['mysql'], PostgreSQL: ['postgresql', 'postgres'], SQLite: ['sqlite'], MongoDB: ['mongodb', 'mongo'], Redis: ['redis'], Firebase: ['firebase'],
  Oracle: ['oracle'], 'SQL Server': ['sql server', 'mssql'],
  Git: ['git'], GitHub: ['github'], 'GitHub Actions': ['github actions'], GitLab: ['gitlab'], Jira: ['jira'], Docker: ['docker'], Kubernetes: ['kubernetes', 'k8s'],
  Terraform: ['terraform'], Ansible: ['ansible'], Jenkins: ['jenkins'], 'CI/CD': ['ci/cd', 'cicd', 'ci-cd'], Nginx: ['nginx'], Linux: ['linux', 'ubuntu', 'debian', 'centos'],
  AWS: ['aws', 'amazon web services'], Azure: ['azure'], GCP: ['gcp', 'google cloud'], 'Google Cloud': [],
  TensorFlow: ['tensorflow'], PyTorch: ['pytorch'], 'Scikit-learn': ['scikit-learn', 'sklearn', 'scikit learn'], Pandas: ['pandas'], NumPy: ['numpy'],
  Keras: ['keras'], OpenCV: ['opencv'], MediaPipe: ['mediapipe'], 'Hugging Face': ['hugging face', 'huggingface'], LangChain: ['langchain'], RAG: ['rag'],
  LLM: ['llm', 'llms'], NLP: ['nlp'], 'Machine Learning': ['machine learning'], 'Deep Learning': ['deep learning'], 'Computer Vision': ['computer vision'],
  'Power BI': ['power bi', 'powerbi'], Tableau: ['tableau'], Excel: ['excel'], ETL: ['etl'], Spark: ['spark', 'pyspark'], Hadoop: ['hadoop'], 'Apache Hive': ['hive', 'hiveql'], Matplotlib: ['matplotlib'], Seaborn: ['seaborn'], DAX: ['dax'], Airflow: ['airflow'],
  Wireshark: ['wireshark'], Nmap: ['nmap'], 'Burp Suite': ['burp suite', 'burp'], Metasploit: ['metasploit'], 'OWASP Top 10': ['owasp'], SIEM: ['siem'], Splunk: ['splunk'],
  Nessus: ['nessus'], Snort: ['snort'], 'Kali Linux': ['kali', 'kali linux'], 'Penetration Testing': ['penetration testing', 'pentest', 'pentesting'],
  'Digital Forensics': ['digital forensics', 'forensics'], IAM: ['iam'], 'Active Directory': ['active directory'], Cryptography: ['cryptography'],
  Playwright: ['playwright'], Cypress: ['cypress'], Selenium: ['selenium'], Pytest: ['pytest'], Jest: ['jest'], JUnit: ['junit'], Postman: ['postman'], JMeter: ['jmeter'],
  'TCP/IP': ['tcp/ip', 'tcp ip'], DNS: ['dns'], DHCP: ['dhcp'], VLAN: ['vlan', 'vlans'], Cisco: ['cisco'], VMware: ['vmware'], Proxmox: ['proxmox'], 'Windows Server': ['windows server'],
  Arduino: ['arduino'], 'Raspberry Pi': ['raspberry pi'], IoT: ['iot'], Figma: ['figma'], Agile: ['agile', 'scrum'], 'Unity': ['unity'], Android: ['android'], SAP: ['sap'], Salesforce: ['salesforce'],
}
delete (TECH as any)['R']
delete (TECH as any)['Google Cloud']

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const TECH_RES: Array<[string, RegExp]> = Object.entries(TECH).map(([canon, aliases]) => {
  const names = [canon.toLowerCase(), ...aliases].map(esc).sort((a, b) => b.length - a.length)
  return [canon, new RegExp(`(?<![A-Za-z0-9+#.])(?:${names.join('|')})(?![A-Za-z0-9+#]|\\.[A-Za-z0-9])`, 'i')] as [string, RegExp]
})
export const TECH_NAMES = Object.keys(TECH)

/** Canonical technology names literally present in `text`. Never infers. */
export function findTech(text: string): string[] {
  const out: string[] = []
  for (const [canon, re] of TECH_RES) if (re.test(text)) out.push(canon)
  // "Go" is only matched case-sensitively as a whole word followed by programming context
  if (/\bGo\b(?=\s*(,|\/|\)|language|developer|programming|backend|microservices))/.test(text) && !out.includes('Go')) out.push('Go')
  return out
}

export const normalizeTech = (s: string) => findTech(s)[0] ?? s.trim()

export const slugify = (s: string, max = 40) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, max) || 'untitled'

export const safeParse = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}
