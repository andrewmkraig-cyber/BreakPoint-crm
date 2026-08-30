-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "JobBoardStatusValue" AS ENUM ('NOT_CONFIGURED', 'READY', 'POSTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "InvoicePaymentMethod" AS ENUM ('CHECK', 'ACH', 'CREDIT');

-- CreateEnum
CREATE TYPE "RetainedSearchStatus" AS ENUM ('OPEN', 'FILLED', 'CLOSED_UNFILLED');

-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('CONFIRMED', 'TENTATIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BDRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'AWAITING_APPROVAL', 'APPROVED', 'ENROLLING', 'COMPLETE', 'FAILED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "SendingDomainStatus" AS ENUM ('HEALTHY', 'WARMING', 'COOLED');

-- CreateEnum
CREATE TYPE "BDActivityKind" AS ENUM ('SCAN_COMPLETE', 'ENRICH', 'ENROLL', 'OPEN', 'REPLY', 'BOUNCE', 'UNSUB', 'DOMAIN_COOLED', 'DOMAIN_RESUMED');

-- CreateEnum
CREATE TYPE "ClientSignalStatus" AS ENUM ('NEW', 'ACTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ScheduledEmailStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT,
    "jobTitle" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "logoData" BYTEA,
    "logoMimeType" TEXT,
    "profileImageData" BYTEA,
    "profileImageMimeType" TEXT,
    "birthday" DATE,
    "workAnniversary" DATE,
    "address" TEXT,
    "tshirtSize" TEXT,
    "autoNightMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "trigger" TEXT,
    "audience" TEXT,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sendAsDraft" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "triggerKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sendAsDraft" BOOLEAN NOT NULL DEFAULT false,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TriggerRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "KpiCache" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KpiCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "metadata" JSONB,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAgreement" (
    "id" TEXT NOT NULL,
    "clientRfId" INTEGER,
    "clientId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadComplete" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT,
    "summaryUpdatedAt" TIMESTAMP(3),
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ClientAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBenefits" (
    "id" TEXT NOT NULL,
    "clientRfId" INTEGER,
    "clientId" TEXT,
    "body" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ClientBenefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBenefitsFile" (
    "id" TEXT NOT NULL,
    "clientRfId" INTEGER,
    "clientId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "blobUrl" TEXT,
    "blobPathname" TEXT,
    "data" BYTEA,
    "uploadComplete" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ClientBenefitsFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Placement" (
    "id" TEXT NOT NULL,
    "candidateRfId" INTEGER,
    "candidateId" TEXT,
    "jobRfId" INTEGER,
    "jobId" TEXT,
    "clientRfId" INTEGER,
    "clientId" TEXT,
    "stage" TEXT NOT NULL,
    "offerReceivedAt" TIMESTAMP(3),
    "offerSalary" DOUBLE PRECISION,
    "offerCompensationType" TEXT DEFAULT 'salary',
    "offerCurrency" TEXT DEFAULT 'USD',
    "offerTitle" TEXT,
    "offerStartDate" TIMESTAMP(3),
    "offerNotes" TEXT,
    "placedAt" TIMESTAMP(3),
    "acceptedSalary" DOUBLE PRECISION,
    "acceptedCompensationType" TEXT DEFAULT 'salary',
    "acceptedCurrency" TEXT DEFAULT 'USD',
    "feePercentage" DOUBLE PRECISION,
    "feeTotal" INTEGER,
    "minFee" INTEGER,
    "guaranteePeriodDays" INTEGER,
    "billingContactName" TEXT,
    "billingContactEmail" TEXT,
    "billingContacts" JSONB,
    "hiringManagerName" TEXT,
    "hiringManagerEmail" TEXT,
    "hiringContacts" JSONB,
    "expectedStartDate" TIMESTAMP(3),
    "placementNotes" TEXT,
    "useCustomTerms" BOOLEAN NOT NULL DEFAULT false,
    "installmentCount" INTEGER,
    "inst1Amount" DOUBLE PRECISION,
    "inst1DaysAfterStart" INTEGER,
    "inst2Amount" DOUBLE PRECISION,
    "inst2DaysAfterStart" INTEGER,
    "inst3Amount" DOUBLE PRECISION,
    "inst3DaysAfterStart" INTEGER,
    "customGuaranteeDate" TIMESTAMP(3),
    "startConfirmedAt" TIMESTAMP(3),
    "startConfirmationFile" BYTEA,
    "startConfirmationMime" TEXT,
    "invoicingFlagged" BOOLEAN NOT NULL DEFAULT false,
    "invoicedAt" TIMESTAMP(3),
    "cityOverride" TEXT,
    "syncedToRf" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "candidateSource" TEXT,
    "retainedSearchId" TEXT,
    "createdById" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Placement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "rfId" INTEGER,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "altEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "altPhones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currentDesignation" TEXT,
    "currentOrganization" TEXT,
    "location" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "linkedinProfile" TEXT,
    "source" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectedSalary" JSONB,
    "notes" TEXT,
    "experience" JSONB,
    "education" JSONB,
    "raw" JSONB,
    "resumeFilename" TEXT,
    "resumeMimeType" TEXT,
    "resumeSize" INTEGER,
    "resumeData" BYTEA,
    "resumeUploadedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateResume" (
    "id" TEXT NOT NULL,
    "candidateRfId" INTEGER,
    "candidateId" TEXT,
    "filename" TEXT NOT NULL,
    "displayName" TEXT,
    "variant" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA,
    "blobUrl" TEXT,
    "uploadComplete" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redactedData" BYTEA,
    "redactedBlobUrl" TEXT,
    "redactedMimeType" TEXT,
    "redactedSize" INTEGER,
    "redactedAt" TIMESTAMP(3),
    "organizationId" TEXT NOT NULL,
    "extractedText" TEXT,

    CONSTRAINT "CandidateResume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "candidateRfId" INTEGER,
    "candidateId" TEXT,
    "jobRfId" INTEGER,
    "jobId" TEXT,
    "clientRfId" INTEGER,
    "clientId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "type" TEXT NOT NULL,
    "meetLink" TEXT,
    "clientAttendees" JSONB,
    "candidatePhone" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "source" TEXT NOT NULL DEFAULT 'ace_scheduled',
    "googleEventIdMine" TEXT,
    "googleEventIdClient" TEXT,
    "googleEventIdCandidate" TEXT,
    "meetConferenceId" TEXT,
    "sentCandidateSubject" TEXT,
    "sentCandidateBody" TEXT,
    "sentCandidateAt" TIMESTAMP(3),
    "sentClientSubject" TEXT,
    "sentClientBody" TEXT,
    "sentClientAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeUpload" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadComplete" BOOLEAN NOT NULL DEFAULT false,
    "uploaderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOverride" (
    "jobRfId" INTEGER NOT NULL,
    "jobId" TEXT,
    "title" TEXT,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "JobOverride_pkey" PRIMARY KEY ("jobRfId")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT,
    "organizationId" TEXT,
    "clientId" TEXT,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "krispcallId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "mediaUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT,
    "organizationId" TEXT,
    "clientId" TEXT,
    "direction" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "duration" INTEGER,
    "status" TEXT NOT NULL,
    "recordingUrl" TEXT,
    "krispcallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallTranscript" (
    "id" TEXT NOT NULL,
    "callLogId" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiWorkspaceMessage" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiWorkspaceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "legacyRfId" INTEGER,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "logoUrl" TEXT,
    "industry" TEXT,
    "linkedinPage" TEXT,
    "careersPage" TEXT,
    "companySize" TEXT,
    "overview" TEXT,
    "candidateBlurb" TEXT,
    "notes" TEXT,
    "location" JSONB,
    "phoneNumbers" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" JSONB,
    "revenue" JSONB,
    "leadOwner" JSONB,
    "customFields" JSONB,
    "addedAt" TIMESTAMP(3),
    "lastContact" TIMESTAMP(3),
    "lastEngagement" TIMESTAMP(3),
    "raw" JSONB,
    "leadSource" TEXT,
    "feeAgreementSigned" BOOLEAN,
    "feeAgreementSignedAt" TIMESTAMP(3),
    "feePct" DOUBLE PRECISION,
    "paymentTermsDays" INTEGER,
    "feeBillingContact" TEXT,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "legacyRfId" INTEGER,
    "title" TEXT NOT NULL,
    "clientId" TEXT,
    "locations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locationCity" TEXT,
    "locationState" TEXT,
    "locationZip" TEXT,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "lifecycle" TEXT DEFAULT 'active',
    "jobStatus" JSONB,
    "jobType" JSONB,
    "employmentType" TEXT,
    "workplaceType" TEXT,
    "hybridSchedule" TEXT,
    "department" TEXT,
    "salaryRangeStart" INTEGER,
    "salaryRangeEnd" INTEGER,
    "salaryCurrency" TEXT,
    "salaryFrequency" TEXT,
    "expectedFee" JSONB,
    "billRate" JSONB,
    "payRate" JSONB,
    "numberOfOpenings" INTEGER,
    "currentOpening" INTEGER,
    "hiringTeam" JSONB,
    "customFields" JSONB,
    "applyLink" TEXT,
    "publishToWebsite" BOOLEAN NOT NULL DEFAULT false,
    "websitePublishedAt" TIMESTAMP(3),
    "websitePriority" INTEGER,
    "lastOpenedAt" TIMESTAMP(3),
    "createdAtRf" TIMESTAMP(3),
    "description" TEXT,
    "sourceJobUrl" TEXT,
    "rawJobDescription" TEXT,
    "descriptionGeneratedAt" TIMESTAMP(3),
    "internalRecruiterNotes" TEXT,
    "searchKeywords" TEXT,
    "savedSearchFilters" JSONB,
    "raw" JSONB,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobBoardStatus" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "boardName" TEXT NOT NULL,
    "status" "JobBoardStatusValue" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "notes" TEXT,
    "externalUrl" TEXT,
    "category" TEXT NOT NULL DEFAULT 'major',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobBoardStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL,
    "scoreBreakdown" JSONB,
    "computedAt" TIMESTAMP(3),
    "sourceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "legacyRfId" INTEGER,
    "firstName" TEXT,
    "lastName" TEXT,
    "name" TEXT,
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phoneNumbers" JSONB,
    "clientId" TEXT,
    "currentDesignation" TEXT,
    "linkedinProfile" TEXT,
    "notes" TEXT,
    "leadOwner" JSONB,
    "addedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "raw" JSONB,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'personal',
    "ownerId" TEXT NOT NULL,
    "mercuryApiKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MicrosoftToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MicrosoftToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailPushWatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastHistoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailPushWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolExpense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "frequency" TEXT NOT NULL,
    "paidCount" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "placementId" TEXT,
    "candidateId" TEXT,
    "clientId" TEXT,
    "roleTitle" TEXT,
    "startDate" TIMESTAMP(3),
    "feeAmount" DECIMAL(10,2),
    "baseSalary" DECIMAL(10,2),
    "feePercentage" DECIMAL(5,2),
    "paymentTerms" TEXT DEFAULT 'Net 30',
    "dueDate" TIMESTAMP(3),
    "billingContacts" JSONB NOT NULL DEFAULT '[]',
    "hiringContacts" JSONB NOT NULL DEFAULT '[]',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "pdfPath" TEXT,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentMethod" "InvoicePaymentMethod",
    "notes" TEXT,
    "clientNote" TEXT,
    "sendFromAlias" TEXT,
    "isFuture" BOOLEAN NOT NULL DEFAULT false,
    "retainedSearchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceEmailDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "threadId" TEXT,
    "sendAsEmail" TEXT,
    "attachments" JSONB,
    "gmailDraftId" TEXT,
    "gmailThreadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceEmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetainedSearch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "paymentTerms" TEXT NOT NULL DEFAULT 'Net 30',
    "guaranteeDays" INTEGER NOT NULL,
    "useInstallments" BOOLEAN NOT NULL DEFAULT false,
    "status" "RetainedSearchStatus" NOT NULL DEFAULT 'OPEN',
    "placementId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetainedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetainedSearchInstallment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "retainedSearchId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetainedSearchInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "calendarName" TEXT NOT NULL DEFAULT 'primary',
    "calendarColor" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "attendees" JSONB,
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "meetLink" TEXT,
    "htmlLink" TEXT,
    "candidateId" TEXT,
    "jobId" TEXT,
    "clientId" TEXT,
    "typeOverride" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaudePanelMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaudePanelMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalTrainerRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalTrainerRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutDay" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dayType" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "ownerKey" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bodyPart" TEXT NOT NULL,
    "defaultDay" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workoutDayId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "exerciseName" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "weightLbs" DOUBLE PRECISION,
    "reps" INTEGER,
    "rpe" DOUBLE PRECISION,
    "isPr" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySteps" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySteps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FitnessHealthConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'apple-health-shortcut',
    "tokenHash" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FitnessHealthConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateListMembership" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateListMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actionType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailThreadTag" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "candidateId" TEXT,
    "clientId" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmailThreadTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordOfDay" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "partOfSpeech" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "exampleSentence" TEXT NOT NULL,
    "generatedDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WordOfDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteOfDay" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "generatedDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteOfDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChessPuzzleOfDay" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lichessId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "fen" TEXT NOT NULL,
    "solution" JSONB NOT NULL,
    "themes" JSONB NOT NULL,
    "generatedDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChessPuzzleOfDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChessPuzzleStreak" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "lastSolvedDate" TEXT,
    "failedDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChessPuzzleStreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunFact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "year" INTEGER,
    "text" TEXT NOT NULL,
    "generatedDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunFactFeedback" (
    "id" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vote" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunFactFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyNewsFeed" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tab" TEXT NOT NULL,
    "headlines" JSONB NOT NULL,
    "generatedDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyNewsFeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vertical" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "dailyCap" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vertical_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "verticalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "theirstackSavedSearchId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "runFrequencyDays" INTEGER NOT NULL DEFAULT 1,
    "lastDiscoveredAt" TIMESTAMP(3),
    "contactCap" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearchVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "savedSearchId" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedSearchVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendingDomain" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" "SendingDomainStatus" NOT NULL DEFAULT 'HEALTHY',
    "apolloMailboxId" TEXT,
    "dailyCap" INTEGER,
    "inboxOwner" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SendingDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BDRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "verticalId" TEXT,
    "savedSearchId" TEXT,
    "status" "BDRunStatus" NOT NULL DEFAULT 'QUEUED',
    "discoveryProvider" TEXT NOT NULL DEFAULT 'theirstack',
    "discoveredCount" INTEGER NOT NULL DEFAULT 0,
    "discoveredPayload" JSONB,
    "approvedAt" TIMESTAMP(3),
    "enrolledCount" INTEGER NOT NULL DEFAULT 0,
    "maxContactsPerCompany" INTEGER,
    "plan" JSONB,
    "metrics" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BDRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "verticalId" TEXT NOT NULL,
    "savedSearchId" TEXT NOT NULL,
    "bdRunId" TEXT,
    "apolloSequenceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enrolled" INTEGER NOT NULL DEFAULT 0,
    "opens" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "bounces" INTEGER NOT NULL DEFAULT 0,
    "unsubs" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" "BDActivityKind" NOT NULL,
    "apolloContactId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BDActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bdRunId" TEXT,
    "kind" "BDActivityKind" NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BDActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BdOrgConfig" (
    "organizationId" TEXT NOT NULL,
    "engineActive" BOOLEAN NOT NULL DEFAULT false,
    "globalDailyCap" INTEGER NOT NULL DEFAULT 80,
    "pauseAll" BOOLEAN NOT NULL DEFAULT false,
    "lastSignalCursorId" TEXT,
    "lastClientMonitorAt" TIMESTAMP(3),
    "blackoutWeekends" BOOLEAN NOT NULL DEFAULT false,
    "blackoutHolidays" BOOLEAN NOT NULL DEFAULT false,
    "blackoutBefore7am" BOOLEAN NOT NULL DEFAULT false,
    "blackoutAfter530pm" BOOLEAN NOT NULL DEFAULT false,
    "replyForwardApollo" BOOLEAN NOT NULL DEFAULT false,
    "replyAutoCreateCandidate" BOOLEAN NOT NULL DEFAULT true,
    "replyOooFilter" BOOLEAN NOT NULL DEFAULT true,
    "replyPromptCreateClient" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BdOrgConfig_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "BdContactTargeting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "verticalId" TEXT NOT NULL,
    "primaryTitles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "smallFirmFallbackTitles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "practiceSpecificTitles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxPerFirm" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BdContactTargeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BdSequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apolloSequenceId" TEXT NOT NULL,
    "verticalId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BdSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BdReplyPromptDismissal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BdReplyPromptDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSignal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "clientId" TEXT,
    "verticalId" TEXT,
    "jobTitle" TEXT NOT NULL,
    "jobLocation" TEXT,
    "jobPostingUrl" TEXT,
    "postedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ClientSignalStatus" NOT NULL DEFAULT 'NEW',
    "actedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "raw" JSONB,
    "source" TEXT NOT NULL DEFAULT 'BD_DISCOVERY',
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "ClientSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AceReminder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reminderAt" TIMESTAMP(3) NOT NULL,
    "notifyLeadsMin" INTEGER[] DEFAULT ARRAY[15]::INTEGER[],
    "notifiedLeadsMin" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "calendarEventId" TEXT,
    "interviewId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AceReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "sourcePlacementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledEmail" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "threadId" TEXT,
    "sendAsEmail" TEXT,
    "attachments" JSONB,
    "gmailDraftId" TEXT,
    "scheduledSendAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "status" "ScheduledEmailStatus" NOT NULL DEFAULT 'SCHEDULED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentMessageId" TEXT,
    "sentThreadId" TEXT,
    "autoTag" BOOLEAN NOT NULL DEFAULT true,
    "candidateId" TEXT,
    "source" TEXT,
    "failureAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstantlyReply" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "instantlyEmailId" TEXT NOT NULL,
    "threadId" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "leadEmail" TEXT,
    "fromEmail" TEXT,
    "subject" TEXT NOT NULL DEFAULT '',
    "snippet" TEXT NOT NULL DEFAULT '',
    "bodyText" TEXT NOT NULL DEFAULT '',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "eaccount" TEXT,
    "isFocused" BOOLEAN NOT NULL DEFAULT true,
    "isAutoReply" BOOLEAN,
    "enrichAttempts" INTEGER NOT NULL DEFAULT 0,
    "isOwnSender" BOOLEAN NOT NULL DEFAULT false,
    "enrichGaveUp" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "instantlyReadSyncedAt" TIMESTAMP(3),
    "instantlyReadSyncAttempts" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstantlyReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_NoteCandidates" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_NoteCandidates_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_NoteClients" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_NoteClients_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_NoteJobs" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_NoteJobs_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "EmailTemplate_trigger_idx" ON "EmailTemplate"("trigger");

-- CreateIndex
CREATE INDEX "EmailTemplate_category_idx" ON "EmailTemplate"("category");

-- CreateIndex
CREATE INDEX "EmailTemplate_sortOrder_idx" ON "EmailTemplate"("sortOrder");

-- CreateIndex
CREATE INDEX "TriggerRule_organizationId_idx" ON "TriggerRule"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TriggerRule_organizationId_triggerKey_key" ON "TriggerRule"("organizationId", "triggerKey");

-- CreateIndex
CREATE UNIQUE INDEX "KpiCache_scope_period_key" ON "KpiCache"("scope", "period");

-- CreateIndex
CREATE INDEX "ActionLog_userId_createdAt_idx" ON "ActionLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActionLog_subjectType_subjectId_idx" ON "ActionLog"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ActionLog_actionType_idx" ON "ActionLog"("actionType");

-- CreateIndex
CREATE INDEX "ActionLog_organizationId_idx" ON "ActionLog"("organizationId");

-- CreateIndex
CREATE INDEX "ClientAgreement_clientRfId_uploadedAt_idx" ON "ClientAgreement"("clientRfId", "uploadedAt");

-- CreateIndex
CREATE INDEX "ClientAgreement_clientId_uploadedAt_idx" ON "ClientAgreement"("clientId", "uploadedAt");

-- CreateIndex
CREATE INDEX "ClientAgreement_organizationId_idx" ON "ClientAgreement"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientBenefits_clientRfId_key" ON "ClientBenefits"("clientRfId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientBenefits_clientId_key" ON "ClientBenefits"("clientId");

-- CreateIndex
CREATE INDEX "ClientBenefits_organizationId_idx" ON "ClientBenefits"("organizationId");

-- CreateIndex
CREATE INDEX "ClientBenefitsFile_clientRfId_uploadedAt_idx" ON "ClientBenefitsFile"("clientRfId", "uploadedAt");

-- CreateIndex
CREATE INDEX "ClientBenefitsFile_clientId_uploadedAt_idx" ON "ClientBenefitsFile"("clientId", "uploadedAt");

-- CreateIndex
CREATE INDEX "ClientBenefitsFile_organizationId_idx" ON "ClientBenefitsFile"("organizationId");

-- CreateIndex
CREATE INDEX "Placement_clientRfId_stage_idx" ON "Placement"("clientRfId", "stage");

-- CreateIndex
CREATE INDEX "Placement_clientId_stage_idx" ON "Placement"("clientId", "stage");

-- CreateIndex
CREATE INDEX "Placement_jobId_stage_idx" ON "Placement"("jobId", "stage");

-- CreateIndex
CREATE INDEX "Placement_stage_expectedStartDate_idx" ON "Placement"("stage", "expectedStartDate");

-- CreateIndex
CREATE INDEX "Placement_candidateId_stage_idx" ON "Placement"("candidateId", "stage");

-- CreateIndex
CREATE INDEX "Placement_organizationId_idx" ON "Placement"("organizationId");

-- CreateIndex
CREATE INDEX "Placement_retainedSearchId_idx" ON "Placement"("retainedSearchId");

-- CreateIndex
CREATE UNIQUE INDEX "Placement_candidateRfId_jobRfId_key" ON "Placement"("candidateRfId", "jobRfId");

-- CreateIndex
CREATE UNIQUE INDEX "Placement_candidateId_jobRfId_key" ON "Placement"("candidateId", "jobRfId");

-- CreateIndex
CREATE UNIQUE INDEX "Placement_candidateId_jobId_key" ON "Placement"("candidateId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_rfId_key" ON "Candidate"("rfId");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_email_key" ON "Candidate"("email");

-- CreateIndex
CREATE INDEX "Candidate_email_idx" ON "Candidate"("email");

-- CreateIndex
CREATE INDEX "Candidate_firstName_idx" ON "Candidate"("firstName");

-- CreateIndex
CREATE INDEX "Candidate_lastName_idx" ON "Candidate"("lastName");

-- CreateIndex
CREATE INDEX "Candidate_createdById_createdAt_idx" ON "Candidate"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "Candidate_organizationId_idx" ON "Candidate"("organizationId");

-- CreateIndex
CREATE INDEX "CandidateResume_organizationId_idx" ON "CandidateResume"("organizationId");

-- CreateIndex
CREATE INDEX "Interview_candidateRfId_scheduledAt_idx" ON "Interview"("candidateRfId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Interview_candidateId_scheduledAt_idx" ON "Interview"("candidateId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Interview_jobRfId_scheduledAt_idx" ON "Interview"("jobRfId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Interview_jobId_scheduledAt_idx" ON "Interview"("jobId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Interview_clientId_scheduledAt_idx" ON "Interview"("clientId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Interview_status_scheduledAt_idx" ON "Interview"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Interview_organizationId_idx" ON "Interview"("organizationId");

-- CreateIndex
CREATE INDEX "ResumeUpload_uploaderId_createdAt_idx" ON "ResumeUpload"("uploaderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobOverride_jobId_key" ON "JobOverride"("jobId");

-- CreateIndex
CREATE INDEX "JobOverride_organizationId_idx" ON "JobOverride"("organizationId");

-- CreateIndex
CREATE INDEX "SmsMessage_organizationId_idx" ON "SmsMessage"("organizationId");

-- CreateIndex
CREATE INDEX "SmsMessage_candidateId_idx" ON "SmsMessage"("candidateId");

-- CreateIndex
CREATE INDEX "SmsMessage_organizationId_createdAt_idx" ON "SmsMessage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CallLog_organizationId_idx" ON "CallLog"("organizationId");

-- CreateIndex
CREATE INDEX "CallLog_candidateId_idx" ON "CallLog"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "CallTranscript_callLogId_key" ON "CallTranscript"("callLogId");

-- CreateIndex
CREATE INDEX "AiWorkspaceMessage_entityType_entityId_idx" ON "AiWorkspaceMessage"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_legacyRfId_key" ON "Client"("legacyRfId");

-- CreateIndex
CREATE INDEX "Client_name_idx" ON "Client"("name");

-- CreateIndex
CREATE INDEX "Client_organizationId_idx" ON "Client"("organizationId");

-- CreateIndex
CREATE INDEX "Client_ownerId_idx" ON "Client"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_legacyRfId_key" ON "Job"("legacyRfId");

-- CreateIndex
CREATE INDEX "Job_clientId_idx" ON "Job"("clientId");

-- CreateIndex
CREATE INDEX "Job_isOpen_idx" ON "Job"("isOpen");

-- CreateIndex
CREATE INDEX "Job_title_idx" ON "Job"("title");

-- CreateIndex
CREATE INDEX "Job_organizationId_idx" ON "Job"("organizationId");

-- CreateIndex
CREATE INDEX "Job_organizationId_publishToWebsite_idx" ON "Job"("organizationId", "publishToWebsite");

-- CreateIndex
CREATE INDEX "Job_organizationId_websitePriority_idx" ON "Job"("organizationId", "websitePriority");

-- CreateIndex
CREATE INDEX "Job_locationCity_idx" ON "Job"("locationCity");

-- CreateIndex
CREATE INDEX "Job_locationState_idx" ON "Job"("locationState");

-- CreateIndex
CREATE INDEX "Job_locationZip_idx" ON "Job"("locationZip");

-- CreateIndex
CREATE INDEX "JobBoardStatus_organizationId_idx" ON "JobBoardStatus"("organizationId");

-- CreateIndex
CREATE INDEX "JobBoardStatus_jobId_idx" ON "JobBoardStatus"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobBoardStatus_jobId_boardName_key" ON "JobBoardStatus"("jobId", "boardName");

-- CreateIndex
CREATE INDEX "CandidateMatch_jobId_score_idx" ON "CandidateMatch"("jobId", "score");

-- CreateIndex
CREATE INDEX "CandidateMatch_organizationId_idx" ON "CandidateMatch"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateMatch_jobId_candidateId_key" ON "CandidateMatch"("jobId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_legacyRfId_key" ON "Contact"("legacyRfId");

-- CreateIndex
CREATE INDEX "Contact_clientId_idx" ON "Contact"("clientId");

-- CreateIndex
CREATE INDEX "Contact_name_idx" ON "Contact"("name");

-- CreateIndex
CREATE INDEX "Contact_organizationId_idx" ON "Contact"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "MicrosoftToken_organizationId_key" ON "MicrosoftToken"("organizationId");

-- CreateIndex
CREATE INDEX "GmailPushWatch_organizationId_idx" ON "GmailPushWatch"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GmailPushWatch_organizationId_email_key" ON "GmailPushWatch"("organizationId", "email");

-- CreateIndex
CREATE INDEX "ToolExpense_organizationId_idx" ON "ToolExpense"("organizationId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_isFuture_idx" ON "Invoice"("organizationId", "isFuture");

-- CreateIndex
CREATE INDEX "Invoice_retainedSearchId_idx" ON "Invoice"("retainedSearchId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_invoiceNumber_key" ON "Invoice"("organizationId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "InvoiceEmailDraft_organizationId_idx" ON "InvoiceEmailDraft"("organizationId");

-- CreateIndex
CREATE INDEX "InvoiceEmailDraft_userId_idx" ON "InvoiceEmailDraft"("userId");

-- CreateIndex
CREATE INDEX "InvoiceEmailDraft_gmailDraftId_idx" ON "InvoiceEmailDraft"("gmailDraftId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceEmailDraft_invoiceId_userId_key" ON "InvoiceEmailDraft"("invoiceId", "userId");

-- CreateIndex
CREATE INDEX "RetainedSearch_organizationId_status_idx" ON "RetainedSearch"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RetainedSearchInstallment_organizationId_idx" ON "RetainedSearchInstallment"("organizationId");

-- CreateIndex
CREATE INDEX "RetainedSearchInstallment_retainedSearchId_idx" ON "RetainedSearchInstallment"("retainedSearchId");

-- CreateIndex
CREATE INDEX "RetainedSearchInstallment_organizationId_retainedSearchId_idx" ON "RetainedSearchInstallment"("organizationId", "retainedSearchId");

-- CreateIndex
CREATE INDEX "CalendarEvent_organizationId_startTime_idx" ON "CalendarEvent"("organizationId", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_organizationId_googleEventId_calendarId_key" ON "CalendarEvent"("organizationId", "googleEventId", "calendarId");

-- CreateIndex
CREATE INDEX "ClaudePanelMessage_organizationId_createdAt_idx" ON "ClaudePanelMessage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ClaudePanelMessage_organizationId_conversationId_idx" ON "ClaudePanelMessage"("organizationId", "conversationId");

-- CreateIndex
CREATE INDEX "PersonalTrainerRule_organizationId_createdAt_idx" ON "PersonalTrainerRule"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkoutDay_organizationId_userId_date_idx" ON "WorkoutDay"("organizationId", "userId", "date");

-- CreateIndex
CREATE INDEX "WorkoutDay_organizationId_userId_startedAt_idx" ON "WorkoutDay"("organizationId", "userId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkoutDay_organizationId_date_idx" ON "WorkoutDay"("organizationId", "date");

-- CreateIndex
CREATE INDEX "WorkoutDay_userId_date_idx" ON "WorkoutDay"("userId", "date");

-- CreateIndex
CREATE INDEX "Exercise_organizationId_isDefault_sortOrder_idx" ON "Exercise"("organizationId", "isDefault", "sortOrder");

-- CreateIndex
CREATE INDEX "Exercise_organizationId_userId_idx" ON "Exercise"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Exercise_organizationId_bodyPart_idx" ON "Exercise"("organizationId", "bodyPart");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_organizationId_ownerKey_slug_key" ON "Exercise"("organizationId", "ownerKey", "slug");

-- CreateIndex
CREATE INDEX "Workout_organizationId_userId_performedAt_idx" ON "Workout"("organizationId", "userId", "performedAt");

-- CreateIndex
CREATE INDEX "Workout_workoutDayId_idx" ON "Workout"("workoutDayId");

-- CreateIndex
CREATE INDEX "Workout_exerciseId_performedAt_idx" ON "Workout"("exerciseId", "performedAt");

-- CreateIndex
CREATE INDEX "WorkoutSet_organizationId_userId_idx" ON "WorkoutSet"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSet_workoutId_setNumber_key" ON "WorkoutSet"("workoutId", "setNumber");

-- CreateIndex
CREATE INDEX "DailySteps_organizationId_date_idx" ON "DailySteps"("organizationId", "date");

-- CreateIndex
CREATE INDEX "DailySteps_userId_date_idx" ON "DailySteps"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailySteps_organizationId_userId_date_key" ON "DailySteps"("organizationId", "userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FitnessHealthConnection_tokenHash_key" ON "FitnessHealthConnection"("tokenHash");

-- CreateIndex
CREATE INDEX "FitnessHealthConnection_organizationId_userId_idx" ON "FitnessHealthConnection"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "FitnessHealthConnection_organizationId_userId_source_key" ON "FitnessHealthConnection"("organizationId", "userId", "source");

-- CreateIndex
CREATE INDEX "CandidateList_organizationId_idx" ON "CandidateList"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateList_organizationId_name_key" ON "CandidateList"("organizationId", "name");

-- CreateIndex
CREATE INDEX "CandidateListMembership_listId_idx" ON "CandidateListMembership"("listId");

-- CreateIndex
CREATE INDEX "CandidateListMembership_candidateId_idx" ON "CandidateListMembership"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateListMembership_listId_candidateId_key" ON "CandidateListMembership"("listId", "candidateId");

-- CreateIndex
CREATE INDEX "ActivityLog_organizationId_timestamp_idx" ON "ActivityLog"("organizationId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "ActivityLog_userId_timestamp_idx" ON "ActivityLog"("userId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "ActivityLog_targetType_targetId_idx" ON "ActivityLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ActivityLog_actionType_idx" ON "ActivityLog"("actionType");

-- CreateIndex
CREATE INDEX "OrganizationMembership_userId_idx" ON "OrganizationMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "GmailThreadTag_candidateId_idx" ON "GmailThreadTag"("candidateId");

-- CreateIndex
CREATE INDEX "GmailThreadTag_clientId_idx" ON "GmailThreadTag"("clientId");

-- CreateIndex
CREATE INDEX "GmailThreadTag_organizationId_idx" ON "GmailThreadTag"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GmailThreadTag_threadId_candidateId_key" ON "GmailThreadTag"("threadId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "GmailThreadTag_threadId_clientId_key" ON "GmailThreadTag"("threadId", "clientId");

-- CreateIndex
CREATE INDEX "WordOfDay_organizationId_idx" ON "WordOfDay"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WordOfDay_organizationId_generatedDate_key" ON "WordOfDay"("organizationId", "generatedDate");

-- CreateIndex
CREATE INDEX "QuoteOfDay_organizationId_idx" ON "QuoteOfDay"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteOfDay_organizationId_generatedDate_key" ON "QuoteOfDay"("organizationId", "generatedDate");

-- CreateIndex
CREATE INDEX "ChessPuzzleOfDay_organizationId_idx" ON "ChessPuzzleOfDay"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChessPuzzleOfDay_organizationId_generatedDate_key" ON "ChessPuzzleOfDay"("organizationId", "generatedDate");

-- CreateIndex
CREATE UNIQUE INDEX "ChessPuzzleStreak_userId_key" ON "ChessPuzzleStreak"("userId");

-- CreateIndex
CREATE INDEX "ChessPuzzleStreak_organizationId_idx" ON "ChessPuzzleStreak"("organizationId");

-- CreateIndex
CREATE INDEX "FunFact_organizationId_idx" ON "FunFact"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FunFact_organizationId_generatedDate_key" ON "FunFact"("organizationId", "generatedDate");

-- CreateIndex
CREATE INDEX "FunFactFeedback_userId_idx" ON "FunFactFeedback"("userId");

-- CreateIndex
CREATE INDEX "FunFactFeedback_factId_idx" ON "FunFactFeedback"("factId");

-- CreateIndex
CREATE UNIQUE INDEX "FunFactFeedback_factId_userId_key" ON "FunFactFeedback"("factId", "userId");

-- CreateIndex
CREATE INDEX "DailyNewsFeed_organizationId_idx" ON "DailyNewsFeed"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyNewsFeed_organizationId_tab_generatedDate_key" ON "DailyNewsFeed"("organizationId", "tab", "generatedDate");

-- CreateIndex
CREATE INDEX "Vertical_organizationId_idx" ON "Vertical"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Vertical_organizationId_slug_key" ON "Vertical"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "SavedSearch_organizationId_idx" ON "SavedSearch"("organizationId");

-- CreateIndex
CREATE INDEX "SavedSearch_verticalId_idx" ON "SavedSearch"("verticalId");

-- CreateIndex
CREATE INDEX "SavedSearchVersion_organizationId_idx" ON "SavedSearchVersion"("organizationId");

-- CreateIndex
CREATE INDEX "SavedSearchVersion_savedSearchId_createdAt_idx" ON "SavedSearchVersion"("savedSearchId", "createdAt");

-- CreateIndex
CREATE INDEX "SendingDomain_organizationId_idx" ON "SendingDomain"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SendingDomain_organizationId_domain_key" ON "SendingDomain"("organizationId", "domain");

-- CreateIndex
CREATE INDEX "BDRun_organizationId_createdAt_idx" ON "BDRun"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "BDRun_status_idx" ON "BDRun"("status");

-- CreateIndex
CREATE INDEX "BDRun_verticalId_idx" ON "BDRun"("verticalId");

-- CreateIndex
CREATE INDEX "BDRun_savedSearchId_idx" ON "BDRun"("savedSearchId");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_idx" ON "Campaign"("organizationId");

-- CreateIndex
CREATE INDEX "Campaign_verticalId_idx" ON "Campaign"("verticalId");

-- CreateIndex
CREATE INDEX "Campaign_active_idx" ON "Campaign"("active");

-- CreateIndex
CREATE INDEX "CampaignEvent_organizationId_occurredAt_idx" ON "CampaignEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "CampaignEvent_campaignId_occurredAt_idx" ON "CampaignEvent"("campaignId", "occurredAt");

-- CreateIndex
CREATE INDEX "CampaignEvent_kind_idx" ON "CampaignEvent"("kind");

-- CreateIndex
CREATE INDEX "BDActivity_organizationId_occurredAt_idx" ON "BDActivity"("organizationId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "BDActivity_bdRunId_idx" ON "BDActivity"("bdRunId");

-- CreateIndex
CREATE INDEX "BDActivity_kind_idx" ON "BDActivity"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "BdContactTargeting_verticalId_key" ON "BdContactTargeting"("verticalId");

-- CreateIndex
CREATE INDEX "BdContactTargeting_organizationId_idx" ON "BdContactTargeting"("organizationId");

-- CreateIndex
CREATE INDEX "BdSequence_organizationId_idx" ON "BdSequence"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BdSequence_organizationId_apolloSequenceId_key" ON "BdSequence"("organizationId", "apolloSequenceId");

-- CreateIndex
CREATE INDEX "BdReplyPromptDismissal_organizationId_idx" ON "BdReplyPromptDismissal"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BdReplyPromptDismissal_organizationId_threadId_key" ON "BdReplyPromptDismissal"("organizationId", "threadId");

-- CreateIndex
CREATE INDEX "ClientSignal_organizationId_status_idx" ON "ClientSignal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ClientSignal_clientId_idx" ON "ClientSignal"("clientId");

-- CreateIndex
CREATE INDEX "ClientSignal_organizationId_discoveredAt_idx" ON "ClientSignal"("organizationId", "discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSignal_organizationId_companyName_jobTitle_key" ON "ClientSignal"("organizationId", "companyName", "jobTitle");

-- CreateIndex
CREATE INDEX "AceReminder_organizationId_idx" ON "AceReminder"("organizationId");

-- CreateIndex
CREATE INDEX "AceReminder_userId_idx" ON "AceReminder"("userId");

-- CreateIndex
CREATE INDEX "AceReminder_calendarEventId_idx" ON "AceReminder"("calendarEventId");

-- CreateIndex
CREATE INDEX "AceReminder_interviewId_idx" ON "AceReminder"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "PushSubscription_organizationId_idx" ON "PushSubscription"("organizationId");

-- CreateIndex
CREATE INDEX "Note_organizationId_createdById_updatedAt_idx" ON "Note"("organizationId", "createdById", "updatedAt");

-- CreateIndex
CREATE INDEX "Note_sourcePlacementId_idx" ON "Note"("sourcePlacementId");

-- CreateIndex
CREATE INDEX "ScheduledEmail_organizationId_idx" ON "ScheduledEmail"("organizationId");

-- CreateIndex
CREATE INDEX "ScheduledEmail_status_scheduledSendAt_idx" ON "ScheduledEmail"("status", "scheduledSendAt");

-- CreateIndex
CREATE INDEX "ScheduledEmail_userId_status_idx" ON "ScheduledEmail"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InstantlyReply_instantlyEmailId_key" ON "InstantlyReply"("instantlyEmailId");

-- CreateIndex
CREATE INDEX "InstantlyReply_organizationId_receivedAt_idx" ON "InstantlyReply"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "InstantlyReply_organizationId_isAutoReply_readAt_idx" ON "InstantlyReply"("organizationId", "isAutoReply", "readAt");

-- CreateIndex
CREATE INDEX "InstantlyReply_organizationId_isOwnSender_receivedAt_idx" ON "InstantlyReply"("organizationId", "isOwnSender", "receivedAt");

-- CreateIndex
CREATE INDEX "InstantlyReply_organizationId_isAutoReply_enrichAttempts_idx" ON "InstantlyReply"("organizationId", "isAutoReply", "enrichAttempts");

-- CreateIndex
CREATE INDEX "_NoteCandidates_B_index" ON "_NoteCandidates"("B");

-- CreateIndex
CREATE INDEX "_NoteClients_B_index" ON "_NoteClients"("B");

-- CreateIndex
CREATE INDEX "_NoteJobs_B_index" ON "_NoteJobs"("B");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerRule" ADD CONSTRAINT "TriggerRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerRule" ADD CONSTRAINT "TriggerRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionLog" ADD CONSTRAINT "ActionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionLog" ADD CONSTRAINT "ActionLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAgreement" ADD CONSTRAINT "ClientAgreement_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAgreement" ADD CONSTRAINT "ClientAgreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAgreement" ADD CONSTRAINT "ClientAgreement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBenefits" ADD CONSTRAINT "ClientBenefits_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBenefits" ADD CONSTRAINT "ClientBenefits_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBenefits" ADD CONSTRAINT "ClientBenefits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBenefitsFile" ADD CONSTRAINT "ClientBenefitsFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBenefitsFile" ADD CONSTRAINT "ClientBenefitsFile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBenefitsFile" ADD CONSTRAINT "ClientBenefitsFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateResume" ADD CONSTRAINT "CandidateResume_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateResume" ADD CONSTRAINT "CandidateResume_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateResume" ADD CONSTRAINT "CandidateResume_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeUpload" ADD CONSTRAINT "ResumeUpload_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOverride" ADD CONSTRAINT "JobOverride_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOverride" ADD CONSTRAINT "JobOverride_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOverride" ADD CONSTRAINT "JobOverride_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallTranscript" ADD CONSTRAINT "CallTranscript_callLogId_fkey" FOREIGN KEY ("callLogId") REFERENCES "CallLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobBoardStatus" ADD CONSTRAINT "JobBoardStatus_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobBoardStatus" ADD CONSTRAINT "JobBoardStatus_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateMatch" ADD CONSTRAINT "CandidateMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateMatch" ADD CONSTRAINT "CandidateMatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateMatch" ADD CONSTRAINT "CandidateMatch_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MicrosoftToken" ADD CONSTRAINT "MicrosoftToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailPushWatch" ADD CONSTRAINT "GmailPushWatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExpense" ADD CONSTRAINT "ToolExpense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "Placement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEmailDraft" ADD CONSTRAINT "InvoiceEmailDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEmailDraft" ADD CONSTRAINT "InvoiceEmailDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEmailDraft" ADD CONSTRAINT "InvoiceEmailDraft_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaudePanelMessage" ADD CONSTRAINT "ClaudePanelMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTrainerRule" ADD CONSTRAINT "PersonalTrainerRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutDay" ADD CONSTRAINT "WorkoutDay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutDay" ADD CONSTRAINT "WorkoutDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_workoutDayId_fkey" FOREIGN KEY ("workoutDayId") REFERENCES "WorkoutDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSet" ADD CONSTRAINT "WorkoutSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSet" ADD CONSTRAINT "WorkoutSet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSet" ADD CONSTRAINT "WorkoutSet_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySteps" ADD CONSTRAINT "DailySteps_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySteps" ADD CONSTRAINT "DailySteps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitnessHealthConnection" ADD CONSTRAINT "FitnessHealthConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitnessHealthConnection" ADD CONSTRAINT "FitnessHealthConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateList" ADD CONSTRAINT "CandidateList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateList" ADD CONSTRAINT "CandidateList_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateListMembership" ADD CONSTRAINT "CandidateListMembership_listId_fkey" FOREIGN KEY ("listId") REFERENCES "CandidateList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateListMembership" ADD CONSTRAINT "CandidateListMembership_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailThreadTag" ADD CONSTRAINT "GmailThreadTag_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailThreadTag" ADD CONSTRAINT "GmailThreadTag_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailThreadTag" ADD CONSTRAINT "GmailThreadTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordOfDay" ADD CONSTRAINT "WordOfDay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteOfDay" ADD CONSTRAINT "QuoteOfDay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChessPuzzleOfDay" ADD CONSTRAINT "ChessPuzzleOfDay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChessPuzzleStreak" ADD CONSTRAINT "ChessPuzzleStreak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChessPuzzleStreak" ADD CONSTRAINT "ChessPuzzleStreak_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunFact" ADD CONSTRAINT "FunFact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunFactFeedback" ADD CONSTRAINT "FunFactFeedback_factId_fkey" FOREIGN KEY ("factId") REFERENCES "FunFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunFactFeedback" ADD CONSTRAINT "FunFactFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyNewsFeed" ADD CONSTRAINT "DailyNewsFeed_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vertical" ADD CONSTRAINT "Vertical_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearchVersion" ADD CONSTRAINT "SavedSearchVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearchVersion" ADD CONSTRAINT "SavedSearchVersion_savedSearchId_fkey" FOREIGN KEY ("savedSearchId") REFERENCES "SavedSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingDomain" ADD CONSTRAINT "SendingDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BDRun" ADD CONSTRAINT "BDRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BDRun" ADD CONSTRAINT "BDRun_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BDRun" ADD CONSTRAINT "BDRun_savedSearchId_fkey" FOREIGN KEY ("savedSearchId") REFERENCES "SavedSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_savedSearchId_fkey" FOREIGN KEY ("savedSearchId") REFERENCES "SavedSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_bdRunId_fkey" FOREIGN KEY ("bdRunId") REFERENCES "BDRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BDActivity" ADD CONSTRAINT "BDActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BDActivity" ADD CONSTRAINT "BDActivity_bdRunId_fkey" FOREIGN KEY ("bdRunId") REFERENCES "BDRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BdOrgConfig" ADD CONSTRAINT "BdOrgConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BdContactTargeting" ADD CONSTRAINT "BdContactTargeting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BdContactTargeting" ADD CONSTRAINT "BdContactTargeting_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BdSequence" ADD CONSTRAINT "BdSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BdSequence" ADD CONSTRAINT "BdSequence_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BdReplyPromptDismissal" ADD CONSTRAINT "BdReplyPromptDismissal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSignal" ADD CONSTRAINT "ClientSignal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSignal" ADD CONSTRAINT "ClientSignal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSignal" ADD CONSTRAINT "ClientSignal_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AceReminder" ADD CONSTRAINT "AceReminder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledEmail" ADD CONSTRAINT "ScheduledEmail_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledEmail" ADD CONSTRAINT "ScheduledEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstantlyReply" ADD CONSTRAINT "InstantlyReply_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NoteCandidates" ADD CONSTRAINT "_NoteCandidates_A_fkey" FOREIGN KEY ("A") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NoteCandidates" ADD CONSTRAINT "_NoteCandidates_B_fkey" FOREIGN KEY ("B") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NoteClients" ADD CONSTRAINT "_NoteClients_A_fkey" FOREIGN KEY ("A") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NoteClients" ADD CONSTRAINT "_NoteClients_B_fkey" FOREIGN KEY ("B") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NoteJobs" ADD CONSTRAINT "_NoteJobs_A_fkey" FOREIGN KEY ("A") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_NoteJobs" ADD CONSTRAINT "_NoteJobs_B_fkey" FOREIGN KEY ("B") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

