"""Sample seed data for local development."""

DEFAULT_SERVICE_OPTIONS = [
    "Campaign set (up to 6 assets)",
    "Custom graphic",
    "Moderate layout graphic",
    "Internal newsletter (up to 3 pages)",
    "External newsletter (up to 3 pages)",
    "Press release",
    "Press release package",
    "Other",
]

DEFAULT_CLIENT_PROFILE = {
    "client_code": "READYONE01",
    "client_name": "ReadyOne Industries",
    "brand_voice_rules": "Direct, confident, workforce-centered. Avoid corporate fluff.",
    "words_to_avoid": ["empowerment journey", "disruption"],
    "required_disclaimers": "EOE employer statement required on recruitment materials.",
    "preferred_tone": "confident and straightforward",
    "common_audiences": ["job seekers", "employers", "internal staff"],
    "default_approver": "Lupita R.",
    "subscription_tier": "Tier 2",
    "credit_menu": {
        "custom_graphic": 25,
        "newsletter_internal": 75,
        "newsletter_external": 90,
        "press_release": 90,
        "campaign_set": 85,
    },
    "turnaround_rules": "Urgent requests should include business impact in notes.",
    "compliance_notes": "Use EOE disclaimer where required.",
    "service_options": DEFAULT_SERVICE_OPTIONS,
}
