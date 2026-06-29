import { InterviewType } from '@/types';

// Track + Topic bucket registry
// Each track maps to an ordered list of topic buckets the user can pick on the
// setup screen. The selected bucket(s) are injected into every Aria system
// prompt so practice stays targeted instead of random.

export interface TrackMeta {
  icon: string;
  hint: string;
  /** Canonical profession string passed to getProfessionContext */
  profession: string;
  topics: string[];
}

export const TRACKS: Record<string, TrackMeta> = {
  // Existing 10
  'UPSC / Civil Services': {
    icon: '🏛️',
    hint: 'IAS, IPS, IFS, IRS — DAF & ethics panel',
    profession: 'UPSC Civil Services',
    topics: [
      'Philosophy / Optional Subject',
      'Current Affairs',
      'Ethics & Integrity',
      'Governance',
      'International Relations',
      'DAF-based Personal Questions',
    ],
  },
  'Bank PO': {
    icon: '🏦',
    hint: 'IBPS PO format — GK, awareness, motivation',
    profession: 'Bank PO',
    topics: [
      'Banking Awareness',
      'Current Affairs',
      'Quantitative Aptitude Concepts',
      'English Language',
      'Personality & Motivation',
      'General Awareness',
    ],
  },
  'SSC CGL': {
    icon: '📋',
    hint: 'Tier I & II — reasoning, GK, English',
    profession: 'SSC CGL',
    topics: [
      'General Intelligence & Reasoning',
      'General Awareness',
      'Quantitative Aptitude',
      'English Comprehension',
      'Personality & Motivation',
    ],
  },
  'Software Developer': {
    icon: '💻',
    hint: 'SDE / SWE — DSA, system design, behavioural',
    profession: 'Software Developer',
    topics: [
      'Data Structures & Algorithms',
      'System Design',
      'Object-Oriented Programming',
      'Coding Practices & Code Review',
      'Behavioural / HR',
      'Distributed Systems',
    ],
  },
  'Data Scientist': {
    icon: '📊',
    hint: 'ML, stats, SQL, case studies',
    profession: 'Data Scientist',
    topics: [
      'Statistics & Probability',
      'Machine Learning Algorithms',
      'Deep Learning & NLP',
      'SQL & Data Engineering',
      'Model Evaluation & MLOps',
      'Case Studies',
    ],
  },
  'Doctor / Medical': {
    icon: '🩺',
    hint: 'Clinical scenarios, ethics, MBBS HR round',
    profession: 'Doctor / Medical',
    topics: [
      'Clinical Reasoning & Diagnosis',
      'Medical Ethics',
      'Patient Communication',
      'National Health Programmes',
      'Research & Evidence-Based Medicine',
      'Behavioural / HR',
    ],
  },
  'Teacher / Educator': {
    icon: '📚',
    hint: 'NEP 2020, pedagogy, demo lesson format',
    profession: 'Teacher',
    topics: [
      'Pedagogy & Teaching Methods',
      'Classroom Management',
      'NEP 2020 & Education Policy',
      'Inclusive Education',
      'EdTech Tools',
      'Behavioural / HR',
    ],
  },
  'Marketing Manager': {
    icon: '📣',
    hint: 'Go-to-market, growth, brand, digital',
    profession: 'Marketing Manager',
    topics: [
      'Go-to-Market Strategy',
      'Digital Marketing Channels',
      'Brand & Positioning',
      'Metrics & Analytics',
      'Campaign Case Studies',
      'Behavioural / HR',
    ],
  },
  'Full Stack Developer': {
    icon: '🖥️',
    hint: 'Frontend + backend + deployment',
    profession: 'Full Stack Developer',
    topics: [
      'Frontend (React, CSS, Performance)',
      'Backend (Node, APIs, Auth)',
      'Databases (SQL & NoSQL)',
      'System Design & Architecture',
      'DevOps & CI/CD',
      'Behavioural / HR',
    ],
  },
  'Police / Defence': {
    icon: '🪖',
    hint: 'SSB, GD, personality test, leadership',
    profession: 'Police / Defence',
    topics: [
      'Motivation & Service Values',
      'Situational Judgement',
      'Physical & Mental Fitness',
      'Constitutional & Legal Knowledge',
      'Leadership Scenarios',
      'Current Affairs & National Security',
    ],
  },

  // New 15
  'RBI Grade B': {
    icon: '🏧',
    hint: 'Macro, monetary policy, finance-heavy',
    profession: 'RBI Grade B Officer',
    topics: [
      'Monetary Policy & Macroeconomics',
      'Financial Markets & Instruments',
      'Banking Regulation & RBI Functions',
      'Indian Economy & Budget',
      'Current Affairs (Finance)',
      'Personality & Motivation',
    ],
  },
  'IBPS PO': {
    icon: '💳',
    hint: 'IBPS PO — awareness, aptitude, HR',
    profession: 'IBPS PO',
    topics: [
      'Banking & Financial Awareness',
      'Current Affairs',
      'Quantitative Aptitude Concepts',
      'Reasoning & Analytical Ability',
      'English Language',
      'Personality & Motivation',
    ],
  },
  'IBPS Clerk': {
    icon: '🗂️',
    hint: 'Clerk-level — foundational awareness & English',
    profession: 'IBPS Clerk',
    topics: [
      'Numerical Ability',
      'General English',
      'General Awareness',
      'Computer Literacy',
      'Personality & Motivation',
    ],
  },
  'SBI PO': {
    icon: '🏦',
    hint: 'SBI-specific culture, leadership, GD rounds',
    profession: 'SBI PO',
    topics: [
      'SBI & Banking Awareness',
      'Current Affairs',
      'Quantitative Aptitude',
      'Group Discussion Topics',
      'SBI Culture & Values',
      'Personality & Motivation',
    ],
  },
  'NABARD': {
    icon: '🌾',
    hint: 'Rural development, agriculture finance',
    profession: 'NABARD Officer',
    topics: [
      'Rural Development & Agriculture',
      'Microfinance & SHGs',
      'Agricultural Credit & Priority Sector',
      'Government Rural Schemes',
      'Economic Geography',
      'Personality & Motivation',
    ],
  },
  'State PSC (Generic)': {
    icon: '🗳️',
    hint: 'State civil services — general GK & ethics',
    profession: 'State PSC Officer',
    topics: [
      'State-specific GK & History',
      'Indian Polity & Constitution',
      'Current Affairs',
      'Ethics & Integrity',
      'Governance & Rural Administration',
      'Personality & Motivation',
    ],
  },
  'Maharashtra PSC': {
    icon: '🟠',
    hint: 'MPSC — Maharashtra history, geography, GK',
    profession: 'Maharashtra PSC Officer',
    topics: [
      'Maharashtra History & Culture',
      'Maharashtra Geography & Economy',
      'State Government Schemes',
      'Indian Polity & Constitution',
      'Current Affairs',
      'Ethics & Personality',
    ],
  },
  'UP PSC': {
    icon: '🏯',
    hint: 'UPPSC — UP-specific GK, Awadh, governance',
    profession: 'UP PSC Officer',
    topics: [
      'Uttar Pradesh History & Culture',
      'UP Geography & Economy',
      'State Government Schemes',
      'Indian Polity & Constitution',
      'Current Affairs',
      'Ethics & Personality',
    ],
  },
  'Judicial Services': {
    icon: '⚖️',
    hint: 'IPC, CPC, legal reasoning, case analysis',
    profession: 'Judicial Services',
    topics: [
      'Indian Penal Code (IPC)',
      'Code of Civil Procedure (CPC)',
      'Code of Criminal Procedure (CrPC)',
      'Constitutional Law',
      'Legal Reasoning & Case Analysis',
      'Personality & Motivation',
    ],
  },
  'NDA / CDS': {
    icon: '🎖️',
    hint: 'Defence motivation, leadership, SSB scenarios',
    profession: 'NDA/CDS Officer Cadet',
    topics: [
      'Defence Motivation & Values',
      'Leadership & Teamwork Scenarios',
      'Current Affairs & National Security',
      'General Knowledge',
      'Physical Fitness & Discipline',
      'Personality Assessment',
    ],
  },
  'Railway NTPC': {
    icon: '🚂',
    hint: 'Technical + general awareness, Railway GK',
    profession: 'Railway NTPC',
    topics: [
      'Railway GK & Awareness',
      'General Science & Technology',
      'Quantitative Aptitude',
      'Reasoning Ability',
      'Current Affairs',
      'Personality & Motivation',
    ],
  },
  'LIC AAO': {
    icon: '📄',
    hint: 'Insurance domain, actuarial basics, GK',
    profession: 'LIC AAO (Insurance Officer)',
    topics: [
      'Insurance & Risk Management',
      'LIC Products & Policies',
      'Financial Awareness',
      'Current Affairs',
      'English Language',
      'Personality & Motivation',
    ],
  },
  'MBA Interview (IIM/XLRI)': {
    icon: '🎓',
    hint: 'Case-based, fit questions, Why MBA',
    profession: 'MBA Aspirant (IIM/XLRI)',
    topics: [
      'Why MBA & Career Goals',
      'Case Study Analysis',
      'Current Affairs & Business',
      'Leadership & Work Experience',
      'Academic Background',
      'Extracurriculars & Achievements',
    ],
  },
  'CA Fresher': {
    icon: '📑',
    hint: 'Accounting standards, audit, IND AS',
    profession: 'Chartered Accountant (Fresher)',
    topics: [
      'Financial Accounting & Reporting',
      'Auditing & Assurance',
      'Taxation (Direct & Indirect)',
      'IND AS / IFRS Standards',
      'Company Law & Compliance',
      'Behavioural / HR',
    ],
  },
  'NGO / Development Sector': {
    icon: '🤝',
    hint: 'Social impact, donor communication, fieldwork',
    profession: 'NGO and Social Sector',
    topics: [
      'Social Impact & Theory of Change',
      'Donor Relations & Fundraising',
      'Community Mobilisation',
      'Monitoring, Evaluation & Learning',
      'Government Scheme Linkages',
      'Behavioural / HR',
    ],
  },
  'Startup / Early-Stage': {
    icon: '🚀',
    hint: 'Founder mindset, product sense, hustle',
    profession: 'Startup Professional',
    topics: [
      'Founder Mindset & Risk Tolerance',
      'Product Sense & User Research',
      'Go-to-Market & Growth Hacking',
      'Fundraising & Investor Relations',
      'Team Building & Culture',
      'Failure & Learning Stories',
    ],
  },
  'Product Manager': {
    icon: '🗺️',
    hint: 'PRD, metrics, prioritisation, product sense',
    profession: 'Product Manager',
    topics: [
      'Product Sense & Design',
      'Metrics & Analytics',
      'Roadmap Prioritisation',
      'Technical Collaboration',
      'User Research',
      'Behavioural / HR',
    ],
  },
  'DevOps / SRE': {
    icon: '🛠️',
    hint: 'Incident management, on-call, reliability',
    profession: 'DevOps / SRE Engineer',
    topics: [
      'CI/CD & Deployment Pipelines',
      'Incident Management & Post-Mortems',
      'Infrastructure as Code',
      'Kubernetes & Container Orchestration',
      'Monitoring & Observability',
      'Behavioural / HR',
    ],
  },
  'UI/UX Designer': {
    icon: '🎨',
    hint: 'Portfolio walkthrough, design critique, process',
    profession: 'UI/UX Designer',
    topics: [
      'Design Process & UX Research',
      'Portfolio Walkthrough',
      'Visual Design & Typography',
      'Interaction Design & Prototyping',
      'Accessibility & Inclusive Design',
      'Behavioural / HR',
    ],
  },
};

/**
 * Returns a one-line topic constraint injected into every Aria system prompt
 * so questions stay inside the buckets the user selected.
 */
export function getTopicConstraint(selectedTopics: string[]): string {
  if (!selectedTopics || selectedTopics.length === 0) return '';
  const list = selectedTopics.map((t) => `"${t}"`).join(', ');
  return `TOPIC CONSTRAINT: Draw all questions exclusively from these topic bucket(s): ${list}. Do not stray into other areas.`;
}

/**
 * Full port of getProfessionContext() from session.js.
 * Returns a rich system prompt segment for a given profession + interview type.
 */
export function getProfessionContext(
  profession: string,
  interviewType: InterviewType
): string {
  const p = (profession || '').toLowerCase();
  const t = (interviewType || '').toLowerCase();
  const is = (...kws: string[]) => kws.some((k) => p.includes(k));

  if (is('ias', 'upsc', 'civil service', 'ips', 'ifs', 'irs', 'pcs', 'collector', 'sdo', 'sdm')) {
    const base = `DOMAIN: Indian Civil Services (UPSC/State PSC)\nKEY TOPICS to draw questions from:\n- Current affairs: recent government schemes, budgets, foreign policy, Supreme Court judgments\n- Public administration: district management, welfare delivery, grievance redressal, RTI, e-governance\n- Ethics & integrity: Nolan principles, conflict of interest, whistleblowing, public trust\n- Indian Polity & Constitution: federalism, fundamental rights, DPSPs, CAG, UPSC role\n- Governance challenges: rural development, tribal welfare, disaster management, corruption\n- Personal scenarios: "You are an SDM and…" / "As a collector you receive…" — situation-based dilemmas\n- Leadership & initiative: examples of innovation in public service, jugaad, ground-level impact`;
    if (t.includes('behav') || t.includes('hr')) return base + `\nBEHAVIORAL FOCUS: Ask about ethical dilemmas they've faced, moments they stood up for what's right, how they handle political pressure, times they showed initiative to serve communities, handling sensitive communal/caste situations with neutrality.`;
    if (t.includes('tech')) return base + `\nTECHNICAL FOCUS: Ask about specific constitutional articles, landmark judgments, government acts (MGNREGA, PMAY, RTI, PESA), five-year plan history, planning commission vs NITI Aayog, budget terminology, fiscal deficit concepts.`;
    return base + `\nMIXED FOCUS: Blend situational ethics questions with factual/policy knowledge, motivation for civil services, and current affairs.`;
  }

  if (is('software', 'developer', 'engineer', 'programmer', 'sde', 'swe', 'backend', 'frontend', 'full stack', 'fullstack')) {
    const base = `DOMAIN: Software Development\nKEY TOPICS to draw questions from:\n- Data structures & algorithms: time/space complexity, arrays, trees, graphs, DP, sorting\n- System design: scalability, load balancing, caching (Redis), databases (SQL vs NoSQL), microservices, APIs\n- Coding practices: SOLID principles, design patterns, code reviews, refactoring, TDD\n- Real scenarios: debugging production issues, handling deadlines, technical debt decisions\n- Distributed systems: CAP theorem, eventual consistency, message queues, race conditions`;
    if (t.includes('tech')) return base + `\nTECHNICAL FOCUS: Dive deep — ask to explain a specific algorithm, design a URL shortener or Twitter feed, debug a given code snippet concept, compare REST vs GraphQL.`;
    if (t.includes('behav') || t.includes('hr')) return base + `\nBEHAVIORAL FOCUS: Ask about dealing with impossible deadlines, disagreeing with a tech lead's architecture decision, mentoring a junior, a time code review caught a critical bug.`;
    return base + `\nMIXED: Combine a system design question, a behavioral scenario about team conflict on tech choices, and a question about staying current with evolving tech.`;
  }

  if (is('java')) return `DOMAIN: Java Development\nKEY TOPICS: JVM internals (GC, memory model, classloading), OOP principles in Java, collections framework (HashMap internals, ConcurrentHashMap), multithreading (synchronized, volatile, ExecutorService, CompletableFuture), Spring/Spring Boot (IoC, DI, AOP, REST), Hibernate/JPA (N+1 problem, lazy loading, transactions), Java 8+ features (streams, lambdas, Optional, records), design patterns (Singleton, Factory, Observer), microservices with Spring Cloud, testing with JUnit/Mockito.\nINTERVIEW STYLE: Ask "How does X work internally?" questions. Example: "Explain what happens when two threads simultaneously call put() on the same HashMap."`;

  if (is('data scientist', 'data science', 'machine learning', 'ml engineer', 'ai engineer', 'data analyst')) return `DOMAIN: Data Science & Machine Learning\nKEY TOPICS: Statistics (p-values, CLT, Bayesian inference, A/B testing), ML algorithms (regression, decision trees, random forests, XGBoost, SVMs), deep learning (CNNs, RNNs, transformers, backprop), feature engineering & selection, model evaluation (precision/recall tradeoffs, ROC-AUC, cross-validation), overfitting/underfitting, data pipelines (Spark, Airflow), real-world deployment (MLOps, model drift, monitoring), SQL for data analysis, Python (pandas, scikit-learn, PyTorch/TensorFlow).\nINTERVIEW STYLE: Ask scenario-based questions: "Your model has 95% accuracy but terrible recall on fraud cases — what do you do?"`;

  if (is('bank', 'banking', 'bank po', 'ibps', 'sbi', 'rbi', 'nbfc', 'financial analyst', 'finance')) return `DOMAIN: Banking & Finance\nKEY TOPICS: Banking fundamentals (CRR, SLR, repo rate, reverse repo, MCLR), RBI monetary policy and its impact, types of loans and NPA management, BASEL norms (I/II/III), priority sector lending, financial inclusion schemes (Jan Dhan, PM SVANidhi), digital banking (UPI, NEFT, RTGS, IMPS), credit appraisal process, KYC/AML regulations, recent banking sector news (mergers, RBI circulars), basic accounting (balance sheet, P&L, working capital).\nINTERVIEW STYLE: Mix situational, knowledge, and motivation questions.`;

  if (is('doctor', 'medical', 'physician', 'mbbs', 'surgeon', 'dentist', 'nurse', 'healthcare', 'clinical')) return `DOMAIN: Medical / Healthcare\nKEY TOPICS: Clinical reasoning and diagnosis approach, patient communication and consent, medical ethics (autonomy, beneficence, non-maleficence, justice), handling emergencies and triage, recent medical advances, teamwork in ICU/OT settings, error disclosure and patient safety, national health programs (Ayushman Bharat, NHM), research and evidence-based medicine.\nINTERVIEW STYLE: Use clinical scenarios, ethical dilemmas, and behavioral questions.`;

  if (is('teacher', 'teaching', 'educator', 'professor', 'lecturer', 'academic', 'school', 'faculty')) return `DOMAIN: Teaching & Education\nKEY TOPICS: Pedagogy and teaching methodologies (Bloom's taxonomy, constructivism, differentiated instruction), classroom management, student engagement, NEP 2020 implications, inclusive education, use of EdTech tools, parent-teacher communication, curriculum design.\nINTERVIEW STYLE: Use scenario questions, ask them to explain how they'd teach a difficult concept to a weak student.`;

  if (is('marketing', 'brand', 'growth', 'digital marketing', 'seo', 'performance market', 'product market')) return `DOMAIN: Marketing\nKEY TOPICS: Go-to-market strategy, brand positioning, digital marketing channels (SEO, SEM, paid social, email, content), funnel analysis (TOFU/MOFU/BOFU), customer segmentation, A/B testing, marketing metrics (CAC, LTV, ROAS, MQL/SQL), CRM tools (HubSpot, Salesforce).\nINTERVIEW STYLE: Ask case-style questions: "How would you launch a new fintech product to tier-2 Indian cities with ₹10L budget?"`;

  if (is('product manager', 'pm', 'product owner', 'apm', 'associate product')) return `DOMAIN: Product Management\nKEY TOPICS: Product vision and roadmap prioritization (RICE, MoSCoW), user research, writing PRDs, metrics definition (north star metric), A/B testing, working with engineering/design, stakeholder management, product sense, competitive landscape, agile/scrum ceremonies.\nINTERVIEW STYLE: Use PM interview formats: "Design a product for elderly people who can't use smartphones." "DAU dropped 15% last week — walk me through your investigation."`;

  if (is('hr', 'human resource', 'people ops', 'talent acquisition', 'recruiter', 'hrbp')) return `DOMAIN: Human Resources\nKEY TOPICS: Full-cycle recruitment, onboarding and retention, performance management (OKRs, PIP process), employee relations, labor law basics (Shops Act, PF/ESI, POSH Act), compensation & benefits, L&D strategy, HR analytics.\nINTERVIEW STYLE: Scenario-based questions: "A top performer is being poached — how do you retain them?"`;

  if (is('government', 'govt', 'ssc', 'cgl', 'railway', 'defence', 'police', 'army', 'military', 'crpf', 'cisf')) return `DOMAIN: Government / Defence / Security Forces\nKEY TOPICS: Duties and responsibilities of the specific role, current national security concerns, constitutional knowledge, physical and mental fitness standards, discipline and chain of command, ethics in uniform — bribery, use of force, public interaction.\nINTERVIEW STYLE: Ask about why they want to serve the nation, handling sensitive situations, knowledge of the specific department's mandate.`;

  return `DOMAIN: ${profession}\nINTERVIEW APPROACH: Ask questions that a senior ${profession} interviewer at a top firm or institution would actually ask. Avoid generic "tell me about yourself" openers. Focus on:\n- Role-specific technical or domain knowledge relevant to ${profession}\n- Real scenarios and problems common in ${profession} work\n- Past experience and decision-making relevant to ${profession}\n- ${t.includes('behav') ? 'Behavioral: STAR-method situations' : t.includes('tech') ? 'Technical depth: How things work, why decisions are made, tradeoffs' : 'Mix of domain knowledge, situational judgment, and motivation'}\nMake every question feel like it was written by a real ${profession} hiring manager, not an AI.`;
}
