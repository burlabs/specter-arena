"""`clean_text`: the one text-cleaning rule the service and the work service share."""

from backend.specter_arena.specters.text import clean_text


def test_text_is_cleaned_of_control_bidi_and_zero_width_characters() -> None:
    assert clean_text("a\u202eb\u200bc\x00d\te\nf  g") == "abcd e f g"


def test_whitespace_runs_collapse_and_the_ends_are_trimmed() -> None:
    assert clean_text("  a \n\t b  ") == "a b"
    assert clean_text("\u200b \u2028") == ""


def test_text_is_normalised_to_nfc() -> None:
    assert clean_text("e\u0301") == "\u00e9"
