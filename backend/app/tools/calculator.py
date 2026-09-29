from pydantic_ai import RunContext


def calculate(ctx: RunContext, expression: str) -> str:
    try:
        allowed = "0123456789+-*/(). %"

        if any(char not in allowed for char in expression):
            return "Invalid mathematical expression."

        result = eval(expression, {"__builtins__": {}}, {})

        return str(result)

    except Exception:
        return "Could not calculate that expression."