"""Question flow definitions for intake."""

from app.models.schemas import IntakeQuestion

CORE_QUESTIONS = [
    IntakeQuestion(id="project_title", label="Project Title", question_type="text"),
    IntakeQuestion(id="goal", label="Goal (desired outcome)", question_type="text"),
    IntakeQuestion(id="target_audience", label="Target Audience", question_type="text"),
    IntakeQuestion(id="primary_cta", label="Primary CTA", question_type="text"),
    IntakeQuestion(
        id="time_sensitivity",
        label="Time Sensitivity",
        question_type="choice",
        options=["Standard", "Soon", "Urgent"],
    ),
    IntakeQuestion(id="due_date", label="Due Date", question_type="date"),
    IntakeQuestion(id="approver", label="Approver", question_type="text"),
    IntakeQuestion(
        id="required_elements",
        label="Required elements (logos, disclaimers, QR codes, etc.)",
        question_type="text",
    ),
    IntakeQuestion(
        id="references",
        label="References / links (comma-separated)",
        question_type="text",
        required=False,
    ),
]

BRANCH_QUESTIONS = {
    "Custom graphic": [
        IntakeQuestion(id="dimensions", label="Dimensions / format", question_type="text"),
        IntakeQuestion(
            id="copy_provided",
            label="Copy provided?",
            question_type="choice",
            options=["Yes", "No"],
        ),
        IntakeQuestion(id="bilingual", label="Bilingual?", question_type="choice", options=["Yes", "No"]),
        IntakeQuestion(id="image_source", label="Stock or provided images?", question_type="text"),
        IntakeQuestion(
            id="accessibility",
            label="Accessibility requirements",
            question_type="text",
            required=False,
        ),
    ],
    "Moderate layout graphic": [
        IntakeQuestion(id="dimensions", label="Dimensions / format", question_type="text"),
        IntakeQuestion(
            id="copy_provided",
            label="Copy provided?",
            question_type="choice",
            options=["Yes", "No"],
        ),
        IntakeQuestion(id="bilingual", label="Bilingual?", question_type="choice", options=["Yes", "No"]),
        IntakeQuestion(id="image_source", label="Stock or provided images?", question_type="text"),
        IntakeQuestion(
            id="accessibility",
            label="Accessibility requirements",
            question_type="text",
            required=False,
        ),
    ],
    "Internal newsletter (up to 3 pages)": [
        IntakeQuestion(id="newsletter_tone", label="Internal or external tone", question_type="text"),
        IntakeQuestion(id="sections", label="Sections required", question_type="text"),
        IntakeQuestion(id="content_status", label="Content provided or drafted?", question_type="text"),
        IntakeQuestion(id="metrics", label="Metrics to include", question_type="text", required=False),
        IntakeQuestion(id="distribution", label="Distribution channel", question_type="text"),
    ],
    "External newsletter (up to 3 pages)": [
        IntakeQuestion(id="newsletter_tone", label="Internal or external tone", question_type="text"),
        IntakeQuestion(id="sections", label="Sections required", question_type="text"),
        IntakeQuestion(id="content_status", label="Content provided or drafted?", question_type="text"),
        IntakeQuestion(id="metrics", label="Metrics to include", question_type="text", required=False),
        IntakeQuestion(id="distribution", label="Distribution channel", question_type="text"),
    ],
    "Press release": [
        IntakeQuestion(id="announcement_summary", label="Announcement summary", question_type="text"),
        IntakeQuestion(
            id="quotes_needed",
            label="Quotes needed?",
            question_type="choice",
            options=["Yes", "No"],
        ),
        IntakeQuestion(
            id="boilerplate",
            label="Boilerplate inclusion",
            question_type="choice",
            options=["Yes", "No"],
        ),
        IntakeQuestion(id="media_targets", label="Media targets", question_type="text"),
        IntakeQuestion(id="assets_needed", label="Assets needed", question_type="text", required=False),
    ],
    "Press release package": [
        IntakeQuestion(id="announcement_summary", label="Announcement summary", question_type="text"),
        IntakeQuestion(
            id="quotes_needed",
            label="Quotes needed?",
            question_type="choice",
            options=["Yes", "No"],
        ),
        IntakeQuestion(
            id="boilerplate",
            label="Boilerplate inclusion",
            question_type="choice",
            options=["Yes", "No"],
        ),
        IntakeQuestion(id="media_targets", label="Media targets", question_type="text"),
        IntakeQuestion(id="assets_needed", label="Assets needed", question_type="text", required=False),
    ],
    "Campaign set (up to 6 assets)": [
        IntakeQuestion(id="channels", label="Channels required", question_type="text"),
        IntakeQuestion(id="asset_list", label="Asset list", question_type="text"),
        IntakeQuestion(id="launch_timeline", label="Launch timeline", question_type="text"),
        IntakeQuestion(
            id="paid_promo",
            label="Paid promotion required?",
            question_type="choice",
            options=["Yes", "No"],
        ),
    ],
    "Other": [
        IntakeQuestion(id="open_description", label="Open description", question_type="text"),
        IntakeQuestion(id="desired_output", label="Desired output format", question_type="text"),
        IntakeQuestion(
            id="clarifications",
            label="Clarifying follow-ups",
            question_type="text",
            required=False,
        ),
    ],
}
