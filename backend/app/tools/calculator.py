import ast
import math
import operator
from typing import Any

from pydantic_ai import RunContext

# Safe binary operations mapping
SAFE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

# Safe math functions and constants
SAFE_FUNCTIONS = {
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "sqrt": math.sqrt,
    "cbrt": getattr(math, "cbrt", lambda x: x ** (1 / 3)),
    "pow": pow,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "asin": math.asin,
    "acos": math.acos,
    "atan": math.atan,
    "log": math.log,
    "log10": math.log10,
    "log2": math.log2,
    "exp": math.exp,
    "ceil": math.ceil,
    "floor": math.floor,
    "factorial": math.factorial,
    "gcd": math.gcd,
}

SAFE_CONSTANTS = {
    "pi": math.pi,
    "e": math.e,
    "tau": getattr(math, "tau", 2 * math.pi),
}

MAX_EXPRESSION_LENGTH = 300
MAX_POWER_EXPONENT = 1000


def _safe_eval_node(node: ast.AST) -> Any:
    """Recursively evaluates an AST node safely without calling eval()."""
    if isinstance(node, ast.Expression):
        return _safe_eval_node(node.body)

    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float, complex)):
            return node.value
        raise ValueError("Only numeric constants are allowed.")

    if isinstance(node, ast.Name):
        if node.id in SAFE_CONSTANTS:
            return SAFE_CONSTANTS[node.id]
        raise ValueError(f"Unknown or unauthorized constant: '{node.id}'")

    if isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type in SAFE_OPERATORS:
            operand = _safe_eval_node(node.operand)
            return SAFE_OPERATORS[op_type](operand)
        raise ValueError(f"Unsupported unary operator: {op_type.__name__}")

    if isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in SAFE_OPERATORS:
            raise ValueError(f"Unsupported binary operator: {op_type.__name__}")

        left = _safe_eval_node(node.left)
        right = _safe_eval_node(node.right)

        # Protection against massive memory denial-of-service via huge exponents
        if op_type is ast.Pow:
            if isinstance(right, (int, float)) and abs(right) > MAX_POWER_EXPONENT:
                raise ValueError(f"Exponent exceeds safety limit of {MAX_POWER_EXPONENT}")

        return SAFE_OPERATORS[op_type](left, right)

    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise ValueError("Only direct safe function calls are allowed.")

        func_name = node.func.id
        if func_name not in SAFE_FUNCTIONS:
            raise ValueError(f"Function '{func_name}' is not allowed.")

        args = [_safe_eval_node(arg) for arg in node.args]
        return SAFE_FUNCTIONS[func_name](*args)

    raise ValueError(f"Unsupported AST node expression: {type(node).__name__}")


def evaluate_expression(expression: str) -> str:
    """Safely evaluates an arithmetic expression using Python's AST parser."""
    clean_expr = expression.strip()
    if not clean_expr:
        return "Expression is empty."

    if len(clean_expr) > MAX_EXPRESSION_LENGTH:
        return f"Expression too long (maximum {MAX_EXPRESSION_LENGTH} characters)."

    try:
        parsed = ast.parse(clean_expr, mode="eval")
        result = _safe_eval_node(parsed)

        # Format integer results without unnecessary decimal point
        if isinstance(result, float) and result.is_integer() and abs(result) < 1e15:
            return str(int(result))

        return str(result)
    except ZeroDivisionError:
        return "Error: Division by zero."
    except OverflowError:
        return "Error: Calculation resulted in an overflow."
    except Exception as err:
        return f"Could not calculate expression: {err}"


def calculate(ctx: RunContext, expression: str) -> str:
    """Calculates mathematical and arithmetic expressions safely and accurately."""
    return evaluate_expression(expression)